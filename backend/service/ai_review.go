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
)

// ─── AI review response ───────────────────────────────────────────────────────

// reviewResponse is the top-level JSON the AI must return for a moderation
// decision. approved=true means the AI recommends approving the quote.
type reviewResponse struct {
	Approved   bool   `json:"approved"`
	Confidence string `json:"confidence"`
	Reason     string `json:"reason"`
}

// ─── Review batch message types (sent over WebSocket) ─────────────────────────

// ReviewLogEntry describes one quote's AI moderation outcome.
type ReviewLogEntry struct {
	QuoteUUID string `json:"quote_uuid"`
	Content   string `json:"content"`
	From      string `json:"from"`
	Approved  bool   `json:"approved"`   // AI verdict
	Confidence string `json:"confidence"`
	Reason    string `json:"reason"`
	IsError   bool   `json:"is_error"`
	ErrorMsg  string `json:"error,omitempty"`
	ChangeID  uint   `json:"change_id"` // AIReviewChange.ID created
	RetryCount int   `json:"retry_count,omitempty"`
	Skipped   bool   `json:"skipped,omitempty"` // already had pending review
	// AutoApplied is true when the decision was auto-applied to the quote;
	// AppliedStatus is the quote status set (approved/rejected).
	AutoApplied   bool   `json:"auto_applied,omitempty"`
	AppliedStatus string `json:"applied_status,omitempty"`
}

// ReviewBatchMsg is one WebSocket message sent to subscribers.
type ReviewBatchMsg struct {
	Type      string          `json:"type"` // start/log/done/stopped/paused/resumed/error/status
	Total     int64           `json:"total,omitempty"`
	Processed int64           `json:"processed,omitempty"`
	Log       *ReviewLogEntry `json:"log,omitempty"`
	Message   string          `json:"message,omitempty"`
	BatchRun  string          `json:"batch_run,omitempty"`
	Paused    bool            `json:"paused,omitempty"`
}

// ─── Settings ─────────────────────────────────────────────────────────────────

// aiReviewSettings reads the AI review configuration for auto-review-on-submit.
// It reuses the shared connection settings but gates on its own
// ai_review_enabled flag (independent of ai_enabled for classify).
func aiReviewSettings() (apiKey, baseURL, modelName string, rpm int, enabled bool) {
	s, _ := repository.FindSettingByKey("ai_review_enabled")
	if s == nil || s.Value != "true" {
		return
	}
	apiKey, baseURL, modelName, rpm = reviewConnSettings()
	if apiKey == "" {
		return
	}
	enabled = true
	return
}

// reviewConnSettings reads only the shared AI connection settings
// (ai_api_key/ai_base_url/ai_model/ai_rpm_limit), with defaults. It does NOT
// gate on any enable flag, so admin-triggered actions (e.g. a one-off batch
// review) can run as long as an API key is configured.
func reviewConnSettings() (apiKey, baseURL, modelName string, rpm int) {
	if s, _ := repository.FindSettingByKey("ai_api_key"); s != nil {
		apiKey = s.Value
	}
	baseURL = "https://api.openai.com/v1"
	if s, _ := repository.FindSettingByKey("ai_base_url"); s != nil && s.Value != "" {
		baseURL = strings.TrimRight(s.Value, "/")
	}
	modelName = "gpt-4o-mini"
	if s, _ := repository.FindSettingByKey("ai_model"); s != nil && s.Value != "" {
		modelName = s.Value
	}
	rpm = 10
	if s, _ := repository.FindSettingByKey("ai_rpm_limit"); s != nil {
		if v, err := strconv.Atoi(s.Value); err == nil && v >= 1 && v <= 30 {
			rpm = v
		}
	}
	return
}

// reviewAutoApplySettings reports whether auto-apply is on, the minimum
// confidence rank a decision must meet to be auto-applied, and whether
// automatic rejection (applying a reject verdict) is allowed.
func reviewAutoApplySettings() (enabled bool, minRank int, allowReject bool) {
	s, _ := repository.FindSettingByKey("ai_review_auto_apply")
	if s == nil || s.Value != "true" {
		return false, 0, false
	}
	enabled = true
	minRank = confidenceRank("high") // default to the strictest threshold
	if c, _ := repository.FindSettingByKey("ai_review_auto_apply_confidence"); c != nil {
		if r := confidenceRank(c.Value); r > 0 {
			minRank = r
		}
	}
	if r, _ := repository.FindSettingByKey("ai_review_auto_apply_reject"); r != nil && r.Value == "true" {
		allowReject = true
	}
	return
}

// PLACEHOLDER_REVIEW_BODY

// ─── Prompt ───────────────────────────────────────────────────────────────────

// defaultReviewPrompt is used when the admin has not configured a custom prompt.
const defaultReviewPrompt = `你是一个语录内容审核助手。请判断这条"一言"（hitokoto）语录是否适合公开展示。
通过标准：内容健康、表达完整、无明显恶意或攻击性、无广告或垃圾信息、无明显错别字堆砌。
不确定时倾向于将 confidence 设为 "low"，交由人工复核。`

// reviewOutputContract is appended AFTER the admin prompt and is NOT
// configurable. It locks the model's output to a single JSON object so the
// admin controls the review CRITERIA while the system controls the FORMAT.
const reviewOutputContract = `

——————（以下为系统要求，必须严格遵守）——————
输出要求：只输出一个 JSON 对象，不要有任何其他文字、解释或 markdown，格式如下：
{"approved":true,"confidence":"high","reason":"简短理由（不超过50字）"}
其中 approved 为布尔值（true=通过，false=不通过）；confidence 取 "high"、"medium" 或 "low"；reason 为简短中文理由。`

// buildReviewPrompt returns the system and user messages for a review call. The
// admin-defined prompt (or the default) governs the criteria; the system always
// appends the output contract.
func buildReviewPrompt(quote *model.Quote) (systemMsg, userMsg string) {
	base := defaultReviewPrompt
	if s, _ := repository.FindSettingByKey("ai_review_prompt"); s != nil && strings.TrimSpace(s.Value) != "" {
		base = strings.TrimSpace(s.Value)
	}
	systemMsg = base + reviewOutputContract

	from := strings.TrimSpace(quote.From)
	userMsg = fmt.Sprintf("语录内容：%s", quote.Content)
	if from != "" {
		userMsg += fmt.Sprintf("\n出处：%s", from)
	}
	return
}

// ─── Core review — writes an AIReviewChange, does NOT touch Quote ─────────────

// reviewOneQuote calls the AI with retries (up to maxRetries), stores an
// AIReviewChange record, optionally auto-applies the decision, and returns a
// ReviewLogEntry. The Quote.Status is only modified by auto-apply.
func reviewOneQuote(ctx context.Context, apiKey, baseURL, modelName string, quote model.Quote, batchRun string) ReviewLogEntry {
	const maxRetries = 10

	entry := ReviewLogEntry{
		QuoteUUID: quote.UUID,
		Content:   truncate(quote.Content, 60),
		From:      quote.From,
	}

	systemMsg, userMsg := buildReviewPrompt(&quote)

	var decision reviewResponse
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if ctx.Err() != nil {
			entry.IsError = true
			entry.ErrorMsg = "已取消"
			return entry
		}
		decision, lastErr = callReviewCompletion(ctx, apiKey, baseURL, modelName, systemMsg, userMsg)
		if lastErr == nil {
			entry.RetryCount = attempt
			break
		}
		if attempt < maxRetries {
			log.Printf("[AI-Review] attempt %d/%d failed for %s: %v", attempt+1, maxRetries, quote.UUID, lastErr)
			backoff := time.Duration(1<<uint(attempt)) * time.Second
			if backoff > 8*time.Second {
				backoff = 8 * time.Second
			}
			select {
			case <-time.After(backoff):
			case <-ctx.Done():
				entry.IsError = true
				entry.ErrorMsg = "已取消"
				return entry
			}
		}
	}

	if lastErr != nil {
		errMsg := truncate(lastErr.Error(), 150)
		log.Printf("[AI-Review] reviewOneQuote gave up after %d retries for %s: %s", maxRetries, quote.UUID, errMsg)
		entry.IsError = true
		entry.ErrorMsg = errMsg
		entry.RetryCount = maxRetries
		return entry
	}

	// Normalise the confidence label to a canonical token so threshold checks
	// (auto-apply / approve-all) are consistent regardless of how the model
	// phrased it (casing, Chinese labels, etc.).
	confidence := "low"
	switch confidenceRank(decision.Confidence) {
	case 3:
		confidence = "high"
	case 2:
		confidence = "medium"
	}
	entry.Approved = decision.Approved
	entry.Confidence = confidence
	entry.Reason = decision.Reason

	change := model.AIReviewChange{
		QuoteID:      quote.ID,
		QuoteUUID:    quote.UUID,
		QuoteContent: truncate(quote.Content, 200),
		QuoteFrom:    quote.From,
		Approved:     decision.Approved,
		Confidence:   confidence,
		Reason:       truncate(decision.Reason, 500),
		BatchRun:     batchRun,
	}
	if err := repository.CreateAIReviewChange(&change); err != nil {
		log.Printf("[AI-Review] failed to save change for %s: %v", quote.UUID, err)
		entry.IsError = true
		entry.ErrorMsg = "保存审核记录失败: " + err.Error()
		return entry
	}
	entry.ChangeID = change.ID

	// Auto-apply: if enabled and the decision meets the confidence threshold,
	// update the quote status directly. Auto-rejection requires explicit opt-in.
	if autoEnabled, minRank, allowReject := reviewAutoApplySettings(); autoEnabled {
		if status, applied := applyReviewDecision(&change, minRank, allowReject); applied {
			_ = repository.UpdateAIReviewChangeStatus(&change, "approved")
			entry.AutoApplied = true
			entry.AppliedStatus = status
		}
	}
	return entry
}

// applyReviewDecision applies a review change's AI verdict to the quote status
// when its confidence meets minRank. An approve verdict sets status "approved";
// a reject verdict sets "rejected" only when allowReject is true (and notifies
// the contributor). It returns the status applied and whether anything changed.
// The caller is responsible for marking the review change "approved".
func applyReviewDecision(change *model.AIReviewChange, minRank int, allowReject bool) (status string, applied bool) {
	if confidenceRank(change.Confidence) < minRank {
		return "", false
	}
	if change.Approved {
		if err := repository.UpdateQuoteStatus(change.QuoteID, "approved"); err != nil {
			log.Printf("[AI-Review] auto-approve failed to update quote %d: %v", change.QuoteID, err)
			return "", false
		}
		return "approved", true
	}
	// Reject verdict
	if !allowReject {
		return "", false
	}
	if err := repository.UpdateQuoteStatus(change.QuoteID, "rejected"); err != nil {
		log.Printf("[AI-Review] auto-reject failed to update quote %d: %v", change.QuoteID, err)
		return "", false
	}
	notifyQuoteRejected(change.QuoteID, change.Reason)
	return "rejected", true
}

// notifyQuoteRejected sends a rejection notification to the quote's contributor.
func notifyQuoteRejected(quoteID uint, reason string) {
	quote, err := repository.FindQuoteByID(quoteID)
	if err != nil || quote == nil {
		return
	}
	content := "您的语录「" + truncate(quote.Content, 50) + "」未通过审核。"
	if strings.TrimSpace(reason) != "" {
		content += "原因：" + reason
	}
	if quote.ContributorID < 0 {
		return
	}
	repository.CreateNotification(&model.Notification{
		UserID:    uint(quote.ContributorID),
		QuoteUUID: quote.UUID,
		Type:      "rejected",
		Title:     "语录未通过审核",
		Content:   content,
	})
}

// ApplyReviewByConfidence applies the stored review change's verdict to its
// quote when the confidence meets minRank, reusing the auto-apply logic. It
// returns the status applied ("approved"/"rejected") or empty if not applied.
// The caller marks the change resolved. allowReject controls whether reject
// verdicts are applied.
func ApplyReviewByConfidence(changeID uint, minRank int, allowReject bool) (string, error) {
	change, err := repository.FindAIReviewChangeByID(changeID)
	if err != nil {
		return "", err
	}
	status, applied := applyReviewDecision(change, minRank, allowReject)
	if !applied {
		return "", nil
	}
	return status, nil
}

// ─── Single-quote async (triggered on submit) ────────────────────────────────

func ReviewQuoteAsync(quote model.Quote) {
	apiKey, baseURL, modelName, rpm, enabled := aiReviewSettings()
	if !enabled {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := getLimiter(rpm).Wait(ctx); err != nil {
		log.Printf("[AI-Review] rate limit wait error for quote %s: %v", quote.UUID, err)
		return
	}

	reviewOneQuote(ctx, apiKey, baseURL, modelName, quote, "")
}

// PLACEHOLDER_REVIEW_BATCH

// ─── Review batch job state ───────────────────────────────────────────────────

type reviewBatchJob struct {
	RunID  string
	cancel context.CancelFunc

	total     int64
	processed int64 // atomic
	filter    repository.QuoteBatchFilter

	mu      sync.RWMutex
	done    bool
	stopped bool
	paused  bool
	pauseCh chan struct{}
	history []ReviewBatchMsg
	subs    map[int]chan ReviewBatchMsg
	nextID  int
}

var (
	reviewBatchMu     sync.Mutex
	activeReviewBatch *reviewBatchJob
)

// ReviewBatchStatus is returned by GetReviewBatchStatus for reconnecting clients.
type ReviewBatchStatus struct {
	Running   bool   `json:"running"`
	Paused    bool   `json:"paused"`
	Done      bool   `json:"done"`
	Stopped   bool   `json:"stopped"`
	Total     int64  `json:"total"`
	Processed int64  `json:"processed"`
	BatchRun  string `json:"batch_run"`
}

func GetReviewBatchStatus() ReviewBatchStatus {
	reviewBatchMu.Lock()
	defer reviewBatchMu.Unlock()
	if activeReviewBatch == nil {
		return ReviewBatchStatus{}
	}
	j := activeReviewBatch
	j.mu.RLock()
	defer j.mu.RUnlock()
	return ReviewBatchStatus{
		Running:   !j.done,
		Paused:    j.paused,
		Done:      j.done,
		Stopped:   j.stopped,
		Total:     j.total,
		Processed: atomic.LoadInt64(&j.processed),
		BatchRun:  j.RunID,
	}
}

func (j *reviewBatchJob) subscribe() (id int, ch chan ReviewBatchMsg) {
	j.mu.Lock()
	defer j.mu.Unlock()

	ch = make(chan ReviewBatchMsg, len(j.history)+512)
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

func (j *reviewBatchJob) unsubscribe(id int) {
	j.mu.Lock()
	defer j.mu.Unlock()
	delete(j.subs, id)
}

func (j *reviewBatchJob) publish(msg ReviewBatchMsg) {
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

func (j *reviewBatchJob) finish(stopped bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.done = true
	j.stopped = stopped
	msgType := "done"
	if stopped {
		msgType = "stopped"
	}
	msg := ReviewBatchMsg{
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
	j.subs = map[int]chan ReviewBatchMsg{}
}

func (j *reviewBatchJob) pauseChannel() chan struct{} {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.pauseCh
}

// ─── Review batch job public API ──────────────────────────────────────────────

func StartBatchReview() error {
	return StartBatchReviewFiltered(repository.QuoteBatchFilter{Status: "pending"})
}

// StartBatchReviewFiltered starts a batch review run restricted to quotes
// matching the given filter. Mirrors StartBatchClassifyFiltered so admins can
// review any submitted quotes (by status, category, search, or only-unreviewed),
// not just pending ones.
func StartBatchReviewFiltered(filter repository.QuoteBatchFilter) error {
	reviewBatchMu.Lock()
	defer reviewBatchMu.Unlock()

	if activeReviewBatch != nil {
		activeReviewBatch.mu.RLock()
		running := !activeReviewBatch.done
		activeReviewBatch.mu.RUnlock()
		if running {
			return fmt.Errorf("审核任务正在进行中")
		}
	}

	// Batch review is an explicit admin action, so it only requires a
	// configured API key — not the auto-review-on-submit toggle.
	apiKey, baseURL, modelName, rpm := reviewConnSettings()
	if apiKey == "" {
		return fmt.Errorf("未配置 AI API Key（请在「系统设置 → AI 配置」中填写）")
	}

	total, err := repository.CountQuotesFiltered(filter)
	if err != nil || total == 0 {
		return fmt.Errorf("没有符合条件的语录")
	}

	ctx, cancel := context.WithCancel(context.Background())
	runID := uuid.New().String()
	job := &reviewBatchJob{
		RunID:   runID,
		cancel:  cancel,
		total:   total,
		filter:  filter,
		history: make([]ReviewBatchMsg, 0, 64),
		subs:    make(map[int]chan ReviewBatchMsg),
		pauseCh: make(chan struct{}),
	}
	close(job.pauseCh) // starts open (not paused)
	activeReviewBatch = job

	job.publish(ReviewBatchMsg{Type: "start", Total: total, BatchRun: runID})

	go runReviewBatch(ctx, job, apiKey, baseURL, modelName, rpm)
	return nil
}

func StopBatchReview() {
	reviewBatchMu.Lock()
	defer reviewBatchMu.Unlock()
	if activeReviewBatch != nil {
		activeReviewBatch.cancel()
	}
}

func PauseBatchReview() error {
	reviewBatchMu.Lock()
	defer reviewBatchMu.Unlock()
	if activeReviewBatch == nil {
		return fmt.Errorf("没有正在运行的任务")
	}
	activeReviewBatch.mu.Lock()
	defer activeReviewBatch.mu.Unlock()
	if activeReviewBatch.done {
		return fmt.Errorf("任务已结束")
	}
	if activeReviewBatch.paused {
		return nil
	}
	activeReviewBatch.paused = true
	activeReviewBatch.pauseCh = make(chan struct{})
	msg := ReviewBatchMsg{Type: "paused", Processed: atomic.LoadInt64(&activeReviewBatch.processed), Total: activeReviewBatch.total, BatchRun: activeReviewBatch.RunID}
	activeReviewBatch.history = append(activeReviewBatch.history, msg)
	for _, ch := range activeReviewBatch.subs {
		select {
		case ch <- msg:
		default:
		}
	}
	return nil
}

func ResumeBatchReview() error {
	reviewBatchMu.Lock()
	defer reviewBatchMu.Unlock()
	if activeReviewBatch == nil {
		return fmt.Errorf("没有正在运行的任务")
	}
	activeReviewBatch.mu.Lock()
	defer activeReviewBatch.mu.Unlock()
	if activeReviewBatch.done {
		return fmt.Errorf("任务已结束")
	}
	if !activeReviewBatch.paused {
		return nil
	}
	activeReviewBatch.paused = false
	close(activeReviewBatch.pauseCh)
	msg := ReviewBatchMsg{Type: "resumed", Processed: atomic.LoadInt64(&activeReviewBatch.processed), Total: activeReviewBatch.total, BatchRun: activeReviewBatch.RunID}
	activeReviewBatch.history = append(activeReviewBatch.history, msg)
	for _, ch := range activeReviewBatch.subs {
		select {
		case ch <- msg:
		default:
		}
	}
	return nil
}

func SubscribeReviewBatch() (id int, ch chan ReviewBatchMsg, job *reviewBatchJob) {
	reviewBatchMu.Lock()
	defer reviewBatchMu.Unlock()
	if activeReviewBatch == nil {
		return -1, nil, nil
	}
	id, ch = activeReviewBatch.subscribe()
	return id, ch, activeReviewBatch
}

func UnsubscribeReviewBatch(id int) {
	reviewBatchMu.Lock()
	j := activeReviewBatch
	reviewBatchMu.Unlock()
	if j != nil && id >= 0 {
		j.unsubscribe(id)
	}
}

// ─── Review batch runner ──────────────────────────────────────────────────────

func runReviewBatch(ctx context.Context, job *reviewBatchJob, apiKey, baseURL, modelName string, rpm int) {
	defer func() {
		stopped := ctx.Err() != nil
		job.finish(stopped)
	}()

	lim := getLimiter(rpm)
	const pageSize = 50

	var afterID uint
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		quotes, err := repository.GetQuotesBatchFilteredAfter(job.filter, afterID, pageSize)
		if err != nil {
			job.publish(ReviewBatchMsg{Type: "error", Message: "读取语录失败: " + err.Error()})
			return
		}
		if len(quotes) == 0 {
			return
		}

		for _, quote := range quotes {
			afterID = quote.ID

			select {
			case <-ctx.Done():
				return
			default:
			}

			// Wait if paused.
			pauseCh := job.pauseChannel()
			select {
			case <-pauseCh:
			case <-ctx.Done():
				return
			}

			// Rate limit.
			waitCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
			if err := lim.Wait(waitCtx); err != nil {
				cancel()
				return
			}
			cancel()

			// Skip if a pending review already exists for this quote in this run.
			if repository.HasPendingAIReviewChange(quote.ID, job.RunID) {
				p := atomic.AddInt64(&job.processed, 1)
				job.publish(ReviewBatchMsg{
					Type:      "log",
					Processed: p,
					Total:     job.total,
					BatchRun:  job.RunID,
					Log: &ReviewLogEntry{
						QuoteUUID: quote.UUID,
						Content:   truncate(quote.Content, 60),
						From:      quote.From,
						Skipped:   true,
						ErrorMsg:  "已有待审核记录，跳过",
					},
				})
				continue
			}

			entry := reviewOneQuote(ctx, apiKey, baseURL, modelName, quote, job.RunID)
			p := atomic.AddInt64(&job.processed, 1)

			job.publish(ReviewBatchMsg{
				Type:      "log",
				Processed: p,
				Total:     job.total,
				BatchRun:  job.RunID,
				Log:       &entry,
			})
		}
	}
}

// ─── OpenAI Chat Completions (review) ─────────────────────────────────────────

func callReviewCompletion(ctx context.Context, apiKey, baseURL, modelName, systemMsg, userMsg string) (reviewResponse, error) {
	var empty reviewResponse
	payload := map[string]any{
		"model": modelName,
		"messages": []map[string]string{
			{"role": "system", "content": systemMsg},
			{"role": "user", "content": userMsg},
		},
		"temperature": 0.0,
		"max_tokens":  200,
	}

	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, "POST", baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return empty, err
	}
	req.Header.Set("Content-Type", "application/json; charset=utf-8")
	req.Header.Set("Authorization", "Bearer "+apiKey)

	client := &http.Client{Timeout: 120 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return empty, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return empty, err
	}
	if resp.StatusCode != http.StatusOK {
		log.Printf("[AI-Review] API non-200 (%d): %s", resp.StatusCode, truncate(string(respBody), 300))
		return empty, fmt.Errorf("AI API 返回 %d: %s", resp.StatusCode, truncate(string(respBody), 200))
	}

	var apiResp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &apiResp); err != nil {
		return empty, fmt.Errorf("解析响应失败: %w", err)
	}
	if len(apiResp.Choices) == 0 {
		return empty, fmt.Errorf("AI 返回空结果")
	}

	content := strings.TrimSpace(apiResp.Choices[0].Message.Content)

	// Strip markdown code fence.
	if strings.HasPrefix(content, "```") {
		if idx := strings.Index(content, "\n"); idx != -1 {
			content = content[idx+1:]
		}
		content = strings.TrimSuffix(strings.TrimSpace(content), "```")
		content = strings.TrimSpace(content)
	}

	// Extract JSON object robustly.
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start == -1 || end == -1 || end < start {
		return empty, fmt.Errorf("AI 响应中未找到 JSON 对象 (内容: %s)", truncate(content, 150))
	}
	content = content[start : end+1]

	// Use a tolerant intermediate with pointers so we can tell a missing field
	// from a present-but-false one. A response missing `approved` or carrying an
	// unrecognised `confidence` is treated as an error so the caller retries
	// (mirrors the classify path, which retries on empty/invalid results).
	var raw struct {
		Approved   *bool  `json:"approved"`
		Confidence string `json:"confidence"`
		Reason     string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(content), &raw); err != nil {
		return empty, fmt.Errorf("解析 AI JSON 失败: %w (内容: %s)", err, truncate(content, 100))
	}
	if raw.Approved == nil {
		return empty, fmt.Errorf("AI 响应缺少 approved 字段 (内容: %s)", truncate(content, 150))
	}
	if confidenceRank(raw.Confidence) == 0 {
		return empty, fmt.Errorf("AI 响应的 confidence 无效: %q (内容: %s)", raw.Confidence, truncate(content, 150))
	}
	return reviewResponse{Approved: *raw.Approved, Confidence: raw.Confidence, Reason: raw.Reason}, nil
}


