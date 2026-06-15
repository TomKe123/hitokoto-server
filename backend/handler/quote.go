package handler

import (
	"math/rand"
	"net/http"
	"strconv"
	"strings"
	"time"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type QuoteHandler struct{}

type CreateQuoteInput struct {
	Content  string `json:"content" binding:"required"`
	From     string `json:"from"`
	Category string `json:"category" binding:"required"`
	Source   string `json:"source"`
}

type UpdateQuoteInput struct {
	Content  string `json:"content"`
	From     string `json:"from"`
	Category string `json:"category"`
	Source   string `json:"source"`
}

func (h *QuoteHandler) Create(c *gin.Context) {
	userID := c.GetUint("user_id")
	userRole, userPerms := resolveUserAuth(c)

	var input CreateQuoteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	status := "pending"
	if userRole == "admin" || permissions.Has(userPerms, permissions.PermReview) {
		status = "approved"
	}

	quote := model.Quote{
		Content:       input.Content,
		From:          input.From,
		Category:      input.Category,
		Source:        input.Source,
		ContributorID: int64(userID),
		Status:        status,
	}

	if err := repository.CreateQuote(&quote); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create quote"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) CreateWithInviteCode(c *gin.Context) {
	setting, err := repository.FindSettingByKey("anonymous_upload")
	if err == nil && setting != nil && setting.Value == "false" {
		c.JSON(http.StatusForbidden, gin.H{"error": "anonymous upload is disabled"})
		return
	}

	var input struct {
		CreateQuoteInput
		InviteCode string `json:"invite_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code, err := repository.FindInviteCodeByCode(input.InviteCode)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite code"})
		return
	}
	if code.UseCount >= code.MaxUses {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invite code has been exhausted"})
		return
	}
	if code.ExpiresAt != nil && time.Now().After(*code.ExpiresAt) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invite code has expired"})
		return
	}

	contributorID := int64(-1)

	quote := model.Quote{
		Content:       input.Content,
		From:          input.From,
		Category:      input.Category,
		Source:        input.Source,
		ContributorID: contributorID,
		Status:        "pending",
	}

	if err := repository.CreateQuote(&quote); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create quote"})
		return
	}

	repository.IncrementInviteCodeUsage(code)

	c.JSON(http.StatusCreated, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) GetByID(c *gin.Context) {
	id := c.Param("id")

	quote, err := repository.FindQuoteByUUIDOrID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.Status != "approved" {
		userID := resolveUserID(c)
		userRole, userPerms := resolveUserAuth(c)
		isOwner := userID != 0 && quote.ContributorID == int64(userID)
		canModerate := userRole == "admin" || permissions.Has(userPerms, permissions.PermReview)
		if !isOwner && !canModerate {
			c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote)})
}

func resolveUserAuth(c *gin.Context) (string, uint64) {
	if role := c.GetString("role"); role != "" {
		perms, _ := c.Get("permissions")
		userPerms, _ := perms.(uint64)
		return role, userPerms
	}

	// AuthMiddleware not applied (public route) — parse JWT directly
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return "", 0
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return "", 0
	}

	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(parts[1], claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(config.Load().JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return "", 0
	}

	role, _ := claims["role"].(string)
	perms, _ := claims["permissions"].(float64)
	return role, uint64(perms)
}

func resolveUserID(c *gin.Context) uint {
	if id := c.GetUint("user_id"); id != 0 {
		return id
	}

	// AuthMiddleware not applied (public route) — parse JWT directly
	authHeader := c.GetHeader("Authorization")
	if authHeader == "" {
		return 0
	}

	parts := strings.SplitN(authHeader, " ", 2)
	if len(parts) != 2 || parts[0] != "Bearer" {
		return 0
	}

	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(parts[1], claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(config.Load().JWTSecret), nil
	})
	if err != nil || !token.Valid {
		return 0
	}

	userID, _ := claims["user_id"].(float64)
	return uint(userID)
}

func (h *QuoteHandler) List(c *gin.Context) {
	page := 1
	pageSize := 20
	categories := c.QueryArray("category")
	keyword := c.Query("keyword")
	searchArr := c.QueryArray("search")

	if keyword != "" {
		searchArr = append(searchArr, keyword)
	}
	status := c.Query("status")
	mine := c.Query("mine")

	if p, err := strconv.Atoi(c.Query("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.Query("page_size")); err == nil && ps > 0 && ps <= 1000 {
		pageSize = ps
	}

	userRole, userPerms := resolveUserAuth(c)
	userID := resolveUserID(c)

	query := repository.QuotesQuery()

	if mine == "true" && userID > 0 {
		query = query.Where("contributor_id = ?", userID)
		if status != "" {
			query = query.Where("status = ?", status)
		}
	} else if userRole == "admin" || permissions.Has(userPerms, permissions.PermReview) {
		if status != "" {
			query = query.Where("status = ?", status)
		}
	} else if userID > 0 {
		query = query.Where("(contributor_id = ?) OR (contributor_id != ? AND status = ?)", userID, userID, "approved")
	} else {
		query = query.Where("status = ?", "approved")
	}

	if len(categories) > 0 {
		query = query.Where("category IN ?", categories)
	}
	query = applySearchFilter(query, searchArr)

	var total int64
	query.Count(&total)

	var quotes []model.Quote
	offset := (page - 1) * pageSize
	query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&quotes)

	responses := make([]gin.H, 0)
	for _, q := range quotes {
		responses = append(responses, toQuoteResponse(q))
	}

	c.JSON(http.StatusOK, gin.H{
		"quotes":      responses,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

func (h *QuoteHandler) Update(c *gin.Context) {
	userID := c.GetUint("user_id")
	role, userPerms := resolveUserAuth(c)
	id := c.Param("id")

	quote, err := repository.FindQuoteByUUIDOrID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	canEditAny := role == "admin" || permissions.Has(userPerms, permissions.PermReview|permissions.PermDeleteQuote)
	if quote.ContributorID != int64(userID) && !canEditAny {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	var input UpdateQuoteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if input.Content != "" {
		updates["content"] = input.Content
	}
	if input.From != "" {
		updates["from"] = input.From
	}
	if input.Category != "" {
		updates["category"] = input.Category
	}
	if input.Source != "" {
		updates["source"] = input.Source
	}

	if quote.Status == "rejected" {
		updates["status"] = "pending"
	}

	if len(updates) == 0 {
		c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote), "message": "no changes"})
		return
	}

	if err := repository.UpdateQuote(quote.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update: " + err.Error()})
		return
	}
	if err := repository.ReloadQuote(quote); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote)})
}

func (h *QuoteHandler) Delete(c *gin.Context) {
	userID := c.GetUint("user_id")
	role, userPerms := resolveUserAuth(c)
	id := c.Param("id")

	quote, err := repository.FindQuoteByUUIDOrID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	canDelete := role == "admin" || permissions.Has(userPerms, permissions.PermDeleteQuote) || quote.ContributorID == int64(userID)
	if !canDelete {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	if quote.ContributorID != int64(userID) {
		createNotification(quote.ContributorID, quote.UUID, "rejected",
			"语录已被删除",
			"您的语录「"+truncateText(quote.Content, 50)+"」已被管理员删除。")
	}

	if err := repository.DeleteQuote(quote); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete quote: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "quote deleted successfully"})
}

func (h *QuoteHandler) Random(c *gin.Context) {
	categories := c.QueryArray("category")
	searchArr := c.QueryArray("search")

	query := repository.ApprovedQuotesQuery()
	if len(categories) > 0 {
		query = query.Where("category IN ?", categories)
	}

	query = applySearchFilter(query, searchArr)

	if anonToken, _ := c.Get("anonymous_token"); anonToken != nil {
		if token, ok := anonToken.(string); ok && token != "" {
			if seen, err := middleware.GetSeenQuotes(token); err == nil && len(seen) > 0 {
				query = query.Where("uuid NOT IN ?", seen)
			}
		}
	}

	var count int64
	if err := query.Count(&count).Error; err != nil || count == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no quotes found"})
		return
	}

	var quote model.Quote
	query.Offset(rand.Intn(int(count))).Limit(1).Find(&quote)

	resp := gin.H{"quote": toQuoteResponse(quote)}
	if anonToken, _ := c.Get("anonymous_token"); anonToken != nil {
		if token, ok := anonToken.(string); ok && token != "" {
			middleware.RecordSeenQuote(token, quote.UUID)
			resp["token"] = token
		}
	}

	c.JSON(http.StatusOK, resp)
}

func (h *QuoteHandler) ListCategories(c *gin.Context) {
	categories, err := repository.ListCategories()
	if err == nil && len(categories) > 0 {
		list := make([]gin.H, 0)
		for _, cat := range categories {
			count, _ := repository.CountApprovedByCategory(cat.Name)
			entry := gin.H{
				"id":    cat.ID,
				"name":  cat.Name,
				"count": count,
			}
			if cat.DisplayName != "" {
				entry["display_name"] = cat.DisplayName
			}
			list = append(list, entry)
		}
		c.JSON(http.StatusOK, gin.H{"categories": list})
		return
	}

	// Fallback: extract unique categories from approved quotes
	results, _ := repository.GetCategoryFallbackStats()
	list := make([]gin.H, 0)
	for _, r := range results {
		list = append(list, gin.H{"name": r.Category, "count": r.Count})
	}
	c.JSON(http.StatusOK, gin.H{"categories": list})
}

func (h *QuoteHandler) StatsPie(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	if days < 0 {
		days = 0
	}
	userID, _ := strconv.ParseInt(c.Query("user_id"), 10, 64)

	query := repository.ApprovedQuotesQuery()

	if days > 0 {
		cutoff := time.Now().AddDate(0, 0, -days)
		query = query.Where("created_at >= ?", cutoff)
	}

	if userID > 0 {
		query = query.Where("contributor_id = ?", userID)
	}

	type PieEntry struct {
		Category string `json:"category"`
		Count    int64  `json:"count"`
	}
	var results []PieEntry
	query.Select("category, COUNT(*) as count").
		Group("category").
		Order("count DESC").
		Find(&results)

	c.JSON(http.StatusOK, gin.H{"data": results})
}

func (h *QuoteHandler) ApproveQuote(c *gin.Context) {
	role, userPerms := resolveUserAuth(c)

	if role != "admin" && !permissions.Has(userPerms, permissions.PermReview) {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	id := c.Param("id")

	quote, err := repository.FindQuoteByUUIDOrID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.Status == "approved" {
		c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote), "message": "already approved"})
		return
	}

	if err := repository.UpdateQuote(quote.ID, map[string]interface{}{"status": "approved"}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update quote: " + err.Error()})
		return
	}
	if err := repository.ReloadQuote(quote); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload quote: " + err.Error()})
		return
	}

	createNotification(quote.ContributorID, quote.UUID, "approved",
		"语录已通过审核",
		"您的语录「"+truncateText(quote.Content, 50)+"」已通过审核。")

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote)})
}

func (h *QuoteHandler) RejectQuote(c *gin.Context) {
	role, userPerms := resolveUserAuth(c)

	if role != "admin" && !permissions.Has(userPerms, permissions.PermReview) {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	id := c.Param("id")

	var input struct {
		Reason string `json:"reason"`
	}
	reason := ""
	if c.ShouldBindJSON(&input) == nil {
		reason = input.Reason
	}

	quote, err := repository.FindQuoteByUUIDOrID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.Status == "rejected" {
		c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote), "message": "already rejected"})
		return
	}

	if err := repository.UpdateQuote(quote.ID, map[string]interface{}{"status": "rejected"}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update quote: " + err.Error()})
		return
	}
	if err := repository.ReloadQuote(quote); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload quote: " + err.Error()})
		return
	}

	notifContent := "您的语录「" + truncateText(quote.Content, 50) + "」未通过审核。"
	if reason != "" {
		notifContent += "原因：" + reason
	}
	createNotification(quote.ContributorID, quote.UUID, "rejected",
		"语录未通过审核", notifContent)

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(*quote)})
}
