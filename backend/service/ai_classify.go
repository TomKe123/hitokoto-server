package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/repository"

	"github.com/google/uuid"
	"golang.org/x/time/rate"
)

// ─── AI multi-suggestion response ────────────────────────────────────────────

// SuggestionItem is one suggestion inside the AI's JSON response.
type SuggestionItem struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	IsNew       bool   `json:"is_new"`
	Confidence  string `json:"confidence"`
	Reason      string `json:"reason"`
}

// aiResponse is the top-level JSON the AI must return.
type aiResponse struct {
	Suggestions []SuggestionItem `json:"suggestions"`
}

// ─── Batch message types (sent over WebSocket) ───────────────────────────────

// BatchLogEntry describes one quote's classification outcome.
type BatchLogEntry struct {
	QuoteUUID   string           `json:"quote_uuid"`
	Content     string           `json:"content"`
	From        string           `json:"from"`
	OldCategory string           `json:"old_category"`
	Suggestions []SuggestionItem `json:"suggestions"` // what AI proposed
	IsError     bool             `json:"is_error"`
	ErrorMsg    string           `json:"error,omitempty"`
	ChangeID    uint             `json:"change_id"` // AIClassifyChange.ID created
	RetryCount  int              `json:"retry_count,omitempty"`
	Skipped     bool             `json:"skipped,omitempty"` // already had pending change
}

// BatchMsg is one WebSocket message sent to subscribers.
type BatchMsg struct {
	Type      string         `json:"type"` // start/log/done/stopped/paused/resumed/error/status
	Total     int64          `json:"total,omitempty"`
	Processed int64          `json:"processed,omitempty"`
	Log       *BatchLogEntry `json:"log,omitempty"`
	Message   string         `json:"message,omitempty"`
	BatchRun  string         `json:"batch_run,omitempty"`
	Paused    bool           `json:"paused,omitempty"`
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────

var (
	limiterMu  sync.Mutex
	limiter    *rate.Limiter
	limiterRPM int
)

func getLimiter(rpm int) *rate.Limiter {
	limiterMu.Lock()
	defer limiterMu.Unlock()
	if limiter == nil || limiterRPM != rpm {
		limiterRPM = rpm
		limiter = rate.NewLimiter(rate.Limit(float64(rpm)/60.0), rpm)
	}
	return limiter
}

// ─── Settings ─────────────────────────────────────────────────────────────────

func aiSettings() (apiKey, baseURL, modelName string, rpm int, enabled bool) {
	s, _ := repository.FindSettingByKey("ai_enabled")
	if s == nil || s.Value != "true" {
		return
	}
	enabled = true

	if s, _ = repository.FindSettingByKey("ai_api_key"); s != nil {
		apiKey = s.Value
	}
	if apiKey == "" {
		enabled = false
		return
	}

	baseURL = "https://api.openai.com/v1"
	if s, _ = repository.FindSettingByKey("ai_base_url"); s != nil && s.Value != "" {
		baseURL = strings.TrimRight(s.Value, "/")
	}

	modelName = "gpt-4o-mini"
	if s, _ = repository.FindSettingByKey("ai_model"); s != nil && s.Value != "" {
		modelName = s.Value
	}

	rpm = 10
	if s, _ = repository.FindSettingByKey("ai_rpm_limit"); s != nil {
		if v, err := strconv.Atoi(s.Value); err == nil && v >= 1 && v <= 30 {
			rpm = v
		}
	}
	return
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

func buildPrompt(quote *model.Quote, categories []model.Category) (systemMsg, userMsg string) {
	var catLines strings.Builder
	for _, c := range categories {
		dn := c.DisplayName
		if dn == "" {
			dn = c.Name
		}
		fmt.Fprintf(&catLines, "  - %s（%s）\n", c.Name, dn)
	}

	systemMsg = `你是一个专业的语录分类助手。你的任务是将"一言"（hitokoto）语录分配到最合适的分类，可以提出多个建议。

当前可用分类：
` + catLines.String() + `
分类规则：
1. 优先从现有分类中选择；每条语录最多提出3个建议，按置信度从高到低排列
2. 语录明确来自某类作品时，优先使用对应分类（anime/comic/game/novel/movie等）
3. 若所有现有分类都不适合，可在 suggestions 中提出新分类：name 用英文小写字母和连字符（如 "technology"），display_name 用中文（如 "科技"），is_new 设为 true
4. 不确定时将 confidence 设为 "low"，而非轻易新建分类

输出要求：只输出一个 JSON 对象，不要有任何其他文字、解释或 markdown，格式如下：
{"suggestions":[{"name":"分类标识","display_name":"显示名称","is_new":false,"confidence":"high","reason":"简短理由"}]}`

	from := strings.TrimSpace(quote.From)
	userMsg = fmt.Sprintf("语录内容：%s", quote.Content)
	if from != "" {
		userMsg += fmt.Sprintf("\n出处：%s", from)
	}
	return
}

// ─── Core classify — writes an AIClassifyChange, does NOT touch Quote ────────

// classifyOneQuote calls the AI with retries (up to maxRetries), stores an
// AIClassifyChange record, and returns a BatchLogEntry.
// The Quote.Category is NOT modified here; admin must approve.
func classifyOneQuote(apiKey, baseURL, modelName string, quote model.Quote, categories []model.Category, batchRun string) BatchLogEntry {
	const maxRetries = 10

	entry := BatchLogEntry{
		QuoteUUID:   quote.UUID,
		Content:     truncate(quote.Content, 60),
		From:        quote.From,
		OldCategory: quote.Category,
	}

	systemMsg, userMsg := buildPrompt(&quote, categories)

	var suggestions []SuggestionItem
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		suggestions, lastErr = callChatCompletion(apiKey, baseURL, modelName, systemMsg, userMsg)
		if lastErr == nil && len(suggestions) > 0 {
			entry.RetryCount = attempt
			break
		}
		if attempt < maxRetries {
			log.Printf("[AI] attempt %d/%d failed for %s: %v", attempt+1, maxRetries, quote.UUID, lastErr)
			// Brief back-off before retry (exponential, cap at 8s)
			backoff := time.Duration(1<<uint(attempt)) * time.Second
			if backoff > 8*time.Second {
				backoff = 8 * time.Second
			}
			time.Sleep(backoff)
		}
	}

	if lastErr != nil || len(suggestions) == 0 {
		errMsg := "AI 返回了空建议列表"
		if lastErr != nil {
			errMsg = truncate(lastErr.Error(), 150)
		}
		log.Printf("[AI] classifyOneQuote gave up after %d retries for %s: %s", maxRetries, quote.UUID, errMsg)
		entry.IsError = true
		entry.ErrorMsg = errMsg
		entry.RetryCount = maxRetries
		return entry
	}

	// Normalise names
	for i := range suggestions {
		suggestions[i].Name = strings.ToLower(strings.TrimSpace(suggestions[i].Name))
	}
	entry.Suggestions = suggestions

	primary := suggestions[0]

	// Check whether primary suggested category already exists
	existingCat := findCategory(categories, primary.Name)
	isNew := primary.IsNew && existingCat == nil

	// Serialise suggestions to JSON for storage
	suggestionsJSON, _ := json.Marshal(suggestions)

	change := model.AIClassifyChange{
		QuoteID:      quote.ID,
		QuoteUUID:    quote.UUID,
		QuoteContent: truncate(quote.Content, 200),
		QuoteFrom:    quote.From,
		OldCategory:  quote.Category,
		Suggestions:  string(suggestionsJSON),
		NewCategory:  primary.Name,
		IsNew:        isNew,
		BatchRun:     batchRun,
	}
	if err := repository.CreateAIChange(&change); err != nil {
		log.Printf("[AI] failed to save change for %s: %v", quote.UUID, err)
		entry.IsError = true
		entry.ErrorMsg = "保存变更记录失败: " + err.Error()
		return entry
	}
	entry.ChangeID = change.ID
	return entry
}

// ─── Single-quote async (triggered on submit) ─────────────────────────────────

func ClassifyQuoteAsync(quote model.Quote) {
	apiKey, baseURL, modelName, rpm, enabled := aiSettings()
	if !enabled {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := getLimiter(rpm).Wait(ctx); err != nil {
		log.Printf("[AI] rate limit wait error for quote %s: %v", quote.UUID, err)
		return
	}

	categories, err := repository.ListCategories()
	if err != nil || len(categories) == 0 {
		return
	}

	classifyOneQuote(apiKey, baseURL, modelName, quote, categories, "")
}

// ─── Batch job state ──────────────────────────────────────────────────────────

type batchJob struct {
	RunID  string
	cancel context.CancelFunc

	total     int64
	processed int64 // atomic

	mu      sync.RWMutex
	done    bool
	paused  bool
	pauseCh chan struct{} // closed to resume; replaced on each pause
	history []BatchMsg
	subs    map[int]chan BatchMsg
	nextID  int
}

var (
	batchMu     sync.Mutex
	activeBatch *batchJob
)

// BatchStatus is returned by GetBatchStatus for clients that reconnect.
type BatchStatus struct {
	Running   bool   `json:"running"`
	Paused    bool   `json:"paused"`
	Done      bool   `json:"done"`
	Total     int64  `json:"total"`
	Processed int64  `json:"processed"`
	BatchRun  string `json:"batch_run"`
}

func GetBatchStatus() BatchStatus {
	batchMu.Lock()
	defer batchMu.Unlock()
	if activeBatch == nil {
		return BatchStatus{}
	}
	j := activeBatch
	j.mu.RLock()
	defer j.mu.RUnlock()
	return BatchStatus{
		Running:   !j.done,
		Paused:    j.paused,
		Done:      j.done,
		Total:     j.total,
		Processed: atomic.LoadInt64(&j.processed),
		BatchRun:  j.RunID,
	}
}

func (j *batchJob) subscribe() (id int, ch chan BatchMsg) {
	j.mu.Lock()
	defer j.mu.Unlock()

	ch = make(chan BatchMsg, len(j.history)+512)
	for _, m := range j.history {
		ch <- m
	}
	if j.done {
		close(ch)
		return -1, ch
	}
	id = j.nextID
	j.nextID++
	j.subs[id] = ch
	return
}

func (j *batchJob) unsubscribe(id int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.subs, id)
}

func (j *batchJob) publish(msg BatchMsg) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.history = append(j.history, msg)
	for _, ch := range j.subs {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (j *batchJob) finish(stopped bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done = true
	msgType := "done"
	if stopped {
		msgType = "stopped"
	}
	msg := BatchMsg{
		Type:      msgType,
		Processed: atomic.LoadInt64(&j.processed),
		Total:     j.total,
		BatchRun:  j.RunID,
	}
	j.history = append(j.history, msg)
	for _, ch := range j.subs {
		select {
		case ch <- msg:
		default:
		}
		close(ch)
	}
	j.subs = map[int]chan BatchMsg{}
}

// pauseChannel returns the current pauseCh under the lock (safe to read).
func (j *batchJob) pauseChannel() chan struct{} {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.pauseCh
}

// ─── Batch job public API ─────────────────────────────────────────────────────

func StartBatchClassify() error {
	batchMu.Lock()
	defer batchMu.Unlock()

	if activeBatch != nil {
		activeBatch.mu.RLock()
		running := !activeBatch.done
		activeBatch.mu.RUnlock()
		if running {
			return fmt.Errorf("分类任务正在进行中")
		}
	}

	apiKey, baseURL, modelName, rpm, enabled := aiSettings()
	if !enabled || apiKey == "" {
		return fmt.Errorf("AI 未启用或未配置 API Key")
	}

	total, err := repository.CountAllQuotes()
	if err != nil || total == 0 {
		return fmt.Errorf("没有可分类的语录")
	}

	ctx, cancel := context.WithCancel(context.Background())
	runID := uuid.New().String()
	job := &batchJob{
		RunID:   runID,
		cancel:  cancel,
		total:   total,
		history: make([]BatchMsg, 0, 64),
		subs:    make(map[int]chan BatchMsg),
		pauseCh: make(chan struct{}), // starts open (not paused)
	}
	// Immediately close pauseCh so the goroutine doesn't block — paused=false
	close(job.pauseCh)
	activeBatch = job

	job.publish(BatchMsg{Type: "start", Total: total, BatchRun: runID})

	go runBatch(ctx, job, apiKey, baseURL, modelName, rpm)
	return nil
}

func StopBatchClassify() {
	batchMu.Lock()
	defer batchMu.Unlock()
	if activeBatch != nil {
		activeBatch.cancel()
	}
}

func PauseBatchClassify() error {
	batchMu.Lock()
	defer batchMu.Unlock()
	if activeBatch == nil {
		return fmt.Errorf("没有正在运行的任务")
	}
	activeBatch.mu.Lock()
	defer activeBatch.mu.Unlock()
	if activeBatch.done {
		return fmt.Errorf("任务已结束")
	}
	if activeBatch.paused {
		return nil // already paused
	}
	activeBatch.paused = true
	// Replace pauseCh with a fresh unclosed channel — goroutine will block on it
	activeBatch.pauseCh = make(chan struct{})
	activeBatch.history = append(activeBatch.history, BatchMsg{
		Type:      "paused",
		Processed: atomic.LoadInt64(&activeBatch.processed),
		Total:     activeBatch.total,
		BatchRun:  activeBatch.RunID,
	})
	for _, ch := range activeBatch.subs {
		select {
		case ch <- BatchMsg{Type: "paused", Processed: atomic.LoadInt64(&activeBatch.processed), Total: activeBatch.total, BatchRun: activeBatch.RunID}:
		default:
		}
	}
	return nil
}

func ResumeBatchClassify() error {
	batchMu.Lock()
	defer batchMu.Unlock()
	if activeBatch == nil {
		return fmt.Errorf("没有正在运行的任务")
	}
	activeBatch.mu.Lock()
	defer activeBatch.mu.Unlock()
	if activeBatch.done {
		return fmt.Errorf("任务已结束")
	}
	if !activeBatch.paused {
		return nil // already running
	}
	activeBatch.paused = false
	close(activeBatch.pauseCh) // unblocks the goroutine
	msg := BatchMsg{Type: "resumed", Processed: atomic.LoadInt64(&activeBatch.processed), Total: activeBatch.total, BatchRun: activeBatch.RunID}
	activeBatch.history = append(activeBatch.history, msg)
	for _, ch := range activeBatch.subs {
		select {
		case ch <- msg:
		default:
		}
	}
	return nil
}

func SubscribeBatch() (id int, ch chan BatchMsg, job *batchJob) {
	batchMu.Lock()
	defer batchMu.Unlock()
	if activeBatch == nil {
		return -1, nil, nil
	}
	id, ch = activeBatch.subscribe()
	return id, ch, activeBatch
}

func UnsubscribeBatch(id int) {
	batchMu.Lock()
	j := activeBatch
	batchMu.Unlock()
	if j != nil && id >= 0 {
		j.unsubscribe(id)
	}
}

// ─── Batch runner ─────────────────────────────────────────────────────────────

func runBatch(ctx context.Context, job *batchJob, apiKey, baseURL, modelName string, rpm int) {
	defer func() {
		stopped := ctx.Err() != nil
		job.finish(stopped)
		batchMu.Lock()
		if activeBatch == job {
			activeBatch = nil
		}
		batchMu.Unlock()
	}()

	lim := getLimiter(rpm)
	const pageSize = 50

	categories, err := repository.ListCategories()
	if err != nil || len(categories) == 0 {
		job.publish(BatchMsg{Type: "error", Message: "无法读取分类列表"})
		return
	}

	var offset int
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		quotes, err := repository.GetQuotesBatch(offset, pageSize)
		if err != nil {
			job.publish(BatchMsg{Type: "error", Message: "读取语录失败: " + err.Error()})
			return
		}
		if len(quotes) == 0 {
			return
		}
		offset += len(quotes)

		for _, quote := range quotes {
			// Check context (stop)
			select {
			case <-ctx.Done():
				return
			default:
			}

			// Wait if paused — blocks until pauseCh is closed (resume) or ctx cancelled
			pauseCh := job.pauseChannel()
			select {
			case <-pauseCh:
				// resumed or was never paused
			case <-ctx.Done():
				return
			}

			// Rate limit
			waitCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			if err := lim.Wait(waitCtx); err != nil {
				cancel()
				return
			}
			cancel()

			// Skip if a pending change already exists for this quote in this run
			if repository.HasPendingAIChange(quote.ID, job.RunID) {
				p := atomic.AddInt64(&job.processed, 1)
				job.publish(BatchMsg{
					Type:      "log",
					Processed: p,
					Total:     job.total,
					BatchRun:  job.RunID,
					Log: &BatchLogEntry{
						QuoteUUID:   quote.UUID,
						Content:     truncate(quote.Content, 60),
						From:        quote.From,
						OldCategory: quote.Category,
						Skipped:     true,
						ErrorMsg:    "已有待审核变更，跳过",
					},
				})
				continue
			}

			entry := classifyOneQuote(apiKey, baseURL, modelName, quote, categories, job.RunID)
			p := atomic.AddInt64(&job.processed, 1)

			job.publish(BatchMsg{
				Type:      "log",
				Processed: p,
				Total:     job.total,
				BatchRun:  job.RunID,
				Log:       &entry,
			})
		}
	}
}

// ─── OpenAI Chat Completions ──────────────────────────────────────────────────

func callChatCompletion(apiKey, baseURL, modelName, systemMsg, userMsg string) ([]SuggestionItem, error) {
	payload := map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "system", "content": systemMsg},
			{"role": "user", "content": userMsg},
		},
		"temperature": 0.2,
		"max_tokens":  400,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[AI] API non-200 (%d): %s", resp.StatusCode, truncate(string(respBody), 300))
		return nil, fmt.Errorf("AI API 返回 %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}
	log.Printf("[AI] raw response: %s", truncate(string(respBody), 500))

	var apiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	if len(apiResp.Choices) == 0 {
		return nil, fmt.Errorf("AI 返回空结果")
	}

	content := strings.TrimSpace(apiResp.Choices[0].Message.Content)

	// Strip markdown code fence
	if strings.HasPrefix(content, "```") {
		if idx := strings.Index(content, "\n"); idx != -1 {
			content = content[idx+1:]
		}
		content = strings.TrimSuffix(strings.TrimSpace(content), "```")
		content = strings.TrimSpace(content)
	}

	// Extract JSON object robustly
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start == -1 || end == -1 || end < start {
		return nil, fmt.Errorf("AI 响应中未找到 JSON 对象 (内容: %s)", truncate(content, 150))
	}
	content = content[start : end+1]

	var result aiResponse
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("解析 AI JSON 失败: %w (内容: %s)", err, truncate(content, 100))
	}
	if len(result.Suggestions) == 0 {
		return nil, fmt.Errorf("AI 返回了空 suggestions 数组")
	}
	return result.Suggestions, nil
}

// ─── Connection test ──────────────────────────────────────────────────────────

func TestConnection(apiKey, baseURL, modelName string) (reply string, latencyMs int64, err error) {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	baseURL = strings.TrimRight(baseURL, "/")
	if modelName == "" {
		modelName = "gpt-4o-mini"
	}

	payload := map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "user", "content": "hi"},
		},
		"temperature": 0.0,
		"max_tokens":  32,
	}
	body, _ := json.Marshal(payload)

	req, err := http.NewRequest("POST", baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", 0, fmt.Errorf("构建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 120 * time.Second}
	start := time.Now()
	resp, err := client.Do(req)
	latencyMs = time.Since(start).Milliseconds()
	if err != nil {
		return "", latencyMs, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", latencyMs, fmt.Errorf("API 返回 %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}

	var apiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &apiResp); err != nil || len(apiResp.Choices) == 0 {
		return "", latencyMs, fmt.Errorf("解析响应失败")
	}

	return strings.TrimSpace(apiResp.Choices[0].Message.Content), latencyMs, nil
}

// ─── Model list ───────────────────────────────────────────────────────────────

func FetchModels(apiKey, baseURL string) ([]string, error) {
	if baseURL == "" {
		baseURL = "https://api.openai.com/v1"
	}
	baseURL = strings.TrimRight(baseURL, "/")

	req, err := http.NewRequest("GET", baseURL+"/models", nil)
	if err != nil {
		return nil, fmt.Errorf("服务商无相关功能或 API 密钥错误")
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("服务商无相关功能或 API 密钥错误")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("服务商无相关功能或 API 密钥错误")
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("服务商无相关功能或 API 密钥错误")
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil || len(result.Data) == 0 {
		return nil, fmt.Errorf("服务商无相关功能或 API 密钥错误")
	}

	ids := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		if m.ID != "" {
			ids = append(ids, m.ID)
		}
	}
	return ids, nil
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func findCategory(cats []model.Category, name string) *model.Category {
	for i := range cats {
		if cats[i].Name == name {
			return &cats[i]
		}
	}
	return nil
}

func truncate(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n]) + "…"
}
