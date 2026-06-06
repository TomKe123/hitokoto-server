package handler

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"

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
	userRole := c.GetString("role")
	perms, _ := c.Get("permissions")
	userPerms, _ := perms.(uint64)

	var input CreateQuoteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Admin and users with review permission are auto-approved
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

	if err := database.DB.Create(&quote).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create quote"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) CreateWithInviteCode(c *gin.Context) {
	// Check anonymous upload setting
	var setting model.Setting
	if err := database.DB.Where("key = ?", "anonymous_upload").First(&setting).Error; err == nil && setting.Value == "false" {
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

	// Validate invite code
	var code model.InviteCode
	if result := database.DB.Where("code = ?", input.InviteCode).First(&code); result.Error != nil {
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

	// Anonymous submission contributor (uid=-1)
	contributorID := int64(-1)

	quote := model.Quote{
		Content:       input.Content,
		From:          input.From,
		Category:      input.Category,
		Source:        input.Source,
		ContributorID: contributorID,
		Status:        "pending",
	}

	if err := database.DB.Create(&quote).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create quote"})
		return
	}

	// Increment invite code usage
	database.DB.Model(&code).Update("use_count", code.UseCount+1)

	c.JSON(http.StatusCreated, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) GetByID(c *gin.Context) {
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	// Hide non-approved quotes from public unless contributor or moderator
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

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

// resolveUserAuth returns role string and permissions uint64 from context or JWT.
func resolveUserAuth(c *gin.Context) (string, uint64) {
	if role := c.GetString("role"); role != "" {
		perms, _ := c.Get("permissions")
		userPerms, _ := perms.(uint64)
		return role, userPerms
	}

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

func resolveUserRole(c *gin.Context) string {
	role, _ := resolveUserAuth(c)
	return role
}

func resolveUserID(c *gin.Context) uint {
	if id := c.GetUint("user_id"); id != 0 {
		return id
	}

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
	category := c.Query("category")
	keyword := c.Query("keyword")
	search := c.Query("search")
	if search != "" && keyword == "" {
		keyword = search
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

	query := database.DB.Model(&model.Quote{})

	if mine == "true" && userID > 0 {
		// Show only current user's quotes (all statuses)
		query = query.Where("contributor_id = ?", userID)
	} else if userRole == "admin" || permissions.Has(userPerms, permissions.PermReview) {
		// Moderator: show all, optionally filtered by status
		if status != "" {
			query = query.Where("status = ?", status)
		}
	} else if userID > 0 {
		// Regular authenticated user: own quotes (all statuses) + others' approved
		query = query.Where("(contributor_id = ?) OR (contributor_id != ? AND status = ?)", userID, userID, "approved")
	} else {
		// Public: only approved
		query = query.Where("status = ?", "approved")
	}

	if category != "" {
		query = query.Where("category = ?", category)
	}
	if keyword != "" {
		escaped := strings.NewReplacer("%", "\\%", "_", "\\_").Replace(keyword)
		like := "%" + escaped + "%"
		query = query.Where("content LIKE ? ESCAPE '\\' OR \"from\" LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\'", like, like, like)
	}

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
	role := c.GetString("role")
	perms, _ := c.Get("permissions")
	userPerms, _ := perms.(uint64)
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	// Allow admin or users with review/delete permissions to edit any quote
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

	// If a rejected quote is updated by its contributor, reset to pending for re-review
	if quote.Status == "rejected" {
		updates["status"] = "pending"
	}

	database.DB.Model(&quote).Updates(updates)
	database.DB.First(&quote, quote.ID)

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) Delete(c *gin.Context) {
	userID := c.GetUint("user_id")
	role := c.GetString("role")
	perms, _ := c.Get("permissions")
	userPerms, _ := perms.(uint64)
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	// Allow admin or users with delete-quote permission, or own quote
	canDelete := role == "admin" || permissions.Has(userPerms, permissions.PermDeleteQuote) || quote.ContributorID == int64(userID)
	if !canDelete {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	// Notify the contributor if deleted by another user
	if quote.ContributorID != int64(userID) {
		createNotification(quote.ContributorID, quote.UUID, "rejected",
			"语录已被删除",
			"您的语录「"+truncateText(quote.Content, 50)+"」已被管理员删除。")
	}

	database.DB.Delete(&quote)
	c.JSON(http.StatusOK, gin.H{"message": "quote deleted successfully"})
}

func (h *QuoteHandler) Random(c *gin.Context) {
	category := c.Query("category")

	query := database.DB.Model(&model.Quote{}).Where("status = ?", "approved")
	if category != "" {
		query = query.Where("category = ?", category)
	}

	// Exclude already-seen quotes for anonymous sessions
	if anonToken, _ := c.Get("anonymous_token"); anonToken != nil {
		if token, ok := anonToken.(string); ok && token != "" {
			if seen, err := middleware.GetSeenQuotes(token); err == nil && len(seen) > 0 {
				query = query.Where("uuid NOT IN ?", seen)
			}
		}
	}

	var quote model.Quote
	if err := query.Order("RANDOM()").First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no quotes found"})
		return
	}

	// Record this quote as seen for anonymous session
	if anonToken, _ := c.Get("anonymous_token"); anonToken != nil {
		if token, ok := anonToken.(string); ok && token != "" {
			middleware.RecordSeenQuote(token, quote.UUID)
		}
	}

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) ListCategories(c *gin.Context) {
	var categories []model.Category
	database.DB.Find(&categories)

	if len(categories) == 0 {
		// Fallback: extract unique categories from approved quotes
		var results []struct {
			Category string
			Count    int64
		}
		database.DB.Model(&model.Quote{}).
			Where("status = ?", "approved").
			Select("category, COUNT(*) as count").
			Group("category").
			Find(&results)

		list := make([]gin.H, 0)
		for _, r := range results {
			list = append(list, gin.H{"name": r.Category, "count": r.Count})
		}
		c.JSON(http.StatusOK, gin.H{"categories": list})
		return
	}

	list := make([]gin.H, 0)
	for _, cat := range categories {
		var count int64
		database.DB.Model(&model.Quote{}).Where("category = ? AND status = ?", cat.Name, "approved").Count(&count)
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
}

// StatsPie returns quote counts grouped by category, filterable by time range and user.
func (h *QuoteHandler) StatsPie(c *gin.Context) {
	days, _ := strconv.Atoi(c.Query("days"))
	if days < 0 {
		days = 0
	}
	userID, _ := strconv.ParseInt(c.Query("user_id"), 10, 64)

	query := database.DB.Model(&model.Quote{}).
		Where("status = ?", "approved")

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

// ApproveQuote approves a pending quote (review permission required).
func (h *QuoteHandler) ApproveQuote(c *gin.Context) {
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.Status == "approved" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quote is already approved"})
		return
	}

	database.DB.Model(&quote).Update("status", "approved")
	database.DB.First(&quote, quote.ID)

	// Notify the contributor
	createNotification(quote.ContributorID, quote.UUID, "approved",
		"语录已通过审核",
		"您的语录「"+truncateText(quote.Content, 50)+"」已通过审核。")

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

// RejectQuote rejects a quote (review permission required).
func (h *QuoteHandler) RejectQuote(c *gin.Context) {
	id := c.Param("id")

	var input struct {
		Reason string `json:"reason"`
	}
	reason := ""
	if c.ShouldBindJSON(&input) == nil {
		reason = input.Reason
	}

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.Status == "rejected" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quote is already rejected"})
		return
	}

	database.DB.Model(&quote).Update("status", "rejected")
	database.DB.First(&quote, quote.ID)

	// Notify the contributor with optional reason
	notifContent := "您的语录「" + truncateText(quote.Content, 50) + "」未通过审核。"
	if reason != "" {
		notifContent += "原因：" + reason
	}
	createNotification(quote.ContributorID, quote.UUID, "rejected",
		"语录未通过审核", notifContent)

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}
