package handler

import (
	"net/http"
	"time"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct{}

func (h *UserHandler) GetProfile(c *gin.Context) {
	id := c.Param("id")

	// Handle anonymous profile (-1)
	if id == "-1" {
		var quoteCount int64
		database.DB.Model(&model.Quote{}).Where("contributor_id = ? AND status = ?", -1, "approved").Count(&quoteCount)
		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"id":          -1,
				"username":    "anonymous",
				"quote_count": quoteCount,
			},
		})
		return
	}

	requestUserID := c.GetUint("user_id")

	var user model.User
	if err := database.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var quoteCount int64
	countQuery := database.DB.Model(&model.Quote{}).Where("contributor_id = ?", user.ID)
	if user.ID == requestUserID {
		countQuery = countQuery.Where("status != ?", "rejected")
	} else {
		countQuery = countQuery.Where("status = ?", "approved")
	}
	countQuery.Count(&quoteCount)

	resp := gin.H{
		"id":          user.ID,
		"username":    user.Username,
		"quote_count": quoteCount,
		"created_at":  user.CreatedAt,
	}

	// Only return email if it's the user's own profile
	if user.ID == requestUserID {
		resp["email"] = user.Email
	}

	c.JSON(http.StatusOK, gin.H{"user": resp})
}

func (h *UserHandler) GetUserQuotes(c *gin.Context) {
	id := c.Param("id")
	requestUserID := c.GetUint("user_id")
	page := 1
	pageSize := 20

	if p, err := parseInt(c.Query("page"), 1); err == nil {
		page = p
	}
	if ps, err := parseInt(c.Query("page_size"), 20); err == nil {
		pageSize = ps
	}

	baseQuery := database.DB.Model(&model.Quote{}).Where("contributor_id = ?", id)
	if id != "-1" && requestUserID == parseUint(id) {
		// Owner sees all except rejected by default; support status filter override
		if status := c.Query("status"); status != "" {
			baseQuery = baseQuery.Where("status = ?", status)
		}
	} else {
		baseQuery = baseQuery.Where("status = ?", "approved")
	}

	var total int64
	baseQuery.Count(&total)

	var quotes []model.Quote
	offset := (page - 1) * pageSize
	baseQuery.Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&quotes)

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

func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID := c.GetUint("user_id")

	var input struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if input.Username != "" {
		var existing model.User
		if result := database.DB.Where("username = ? AND id != ?", input.Username, userID).First(&existing); result.Error == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username already exists"})
			return
		}
		updates["username"] = input.Username
	}
	if input.Email != "" {
		var existing model.User
		if result := database.DB.Where("email = ? AND id != ?", input.Email, userID).First(&existing); result.Error == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
			return
		}
		updates["email"] = input.Email
	}

	if len(updates) > 0 {
		database.DB.Model(&model.User{}).Where("id = ?", userID).Updates(updates)
	}

	var user model.User
	database.DB.First(&user, userID)

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
		},
	})
}

func (h *UserHandler) ChangePassword(c *gin.Context) {
	userID := c.GetUint("user_id")

	var input struct {
		OldPassword string `json:"old_password" binding:"required"`
		NewPassword string `json:"new_password" binding:"required,min=8"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var user model.User
	database.DB.First(&user, userID)

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.OldPassword)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "old password is incorrect"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	database.DB.Model(&user).Update("password_hash", string(hashedPassword))
	c.JSON(http.StatusOK, gin.H{"message": "password changed successfully"})
}

func (h *UserHandler) GenerateUserInviteCode(c *gin.Context) {
	userID := c.GetUint("user_id")

	var input struct {
		CustomCode string `json:"custom_code"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check rate limit: at most once per 72 hours
	var user model.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if user.LastCodeGeneratedAt != nil {
		elapsed := time.Since(*user.LastCodeGeneratedAt)
		cooldown := 72 * time.Hour
		if elapsed < cooldown {
			remaining := cooldown - elapsed
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":         "请等待 " + remaining.Round(time.Second).String() + " 后再次生成",
				"next_allowed_at": user.LastCodeGeneratedAt.Add(cooldown),
			})
			return
		}
	}

	codeStr := input.CustomCode
	if codeStr == "" {
		codeStr = generateCode(8)
	}

	code := model.InviteCode{
		Code:      codeStr,
		MaxUses:   5,
		CreatedBy: userID,
	}
	if err := database.DB.Create(&code).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成邀请码失败，可能该代码已存在"})
		return
	}

	// Update last_code_generated_at
	now := time.Now()
	database.DB.Model(&user).Update("last_code_generated_at", &now)

	resp := gin.H{
		"id":        code.ID,
		"code":      code.Code,
		"max_uses":  code.MaxUses,
		"created_at": code.CreatedAt,
	}
	if code.ExpiresAt != nil {
		resp["expires_at"] = code.ExpiresAt
	}

	c.JSON(http.StatusCreated, gin.H{"code": resp})
}

func (h *UserHandler) ListUserInviteCodes(c *gin.Context) {
	userID := c.GetUint("user_id")
	page := 1
	pageSize := 20

	if p, err := parseInt(c.Query("page"), 1); err == nil {
		page = p
	}
	if ps, err := parseInt(c.Query("page_size"), 20); err == nil {
		pageSize = ps
	}

	var total int64
	database.DB.Model(&model.InviteCode{}).Where("created_by = ?", userID).Count(&total)

	var codes []model.InviteCode
	offset := (page - 1) * pageSize
	database.DB.Where("created_by = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&codes)

	// Calculate next allowed generation time
	var user model.User
	database.DB.First(&user, userID)

	var nextAllowedAt *time.Time
	if user.LastCodeGeneratedAt != nil {
		nextAllowed := user.LastCodeGeneratedAt.Add(72 * time.Hour)
		if time.Now().Before(nextAllowed) {
			nextAllowedAt = &nextAllowed
		}
	}

	responses := make([]gin.H, 0)
	for _, c := range codes {
		resp := gin.H{
			"id":         c.ID,
			"code":       c.Code,
			"max_uses":   c.MaxUses,
			"use_count":  c.UseCount,
			"created_at": c.CreatedAt,
		}
		if c.ExpiresAt != nil {
			resp["expires_at"] = c.ExpiresAt
		}
		responses = append(responses, resp)
	}

	c.JSON(http.StatusOK, gin.H{
		"codes":           responses,
		"total":           total,
		"page":            page,
		"page_size":       pageSize,
		"total_pages":     (int(total) + pageSize - 1) / pageSize,
		"next_allowed_at": nextAllowedAt,
	})
}

func (h *UserHandler) Leaderboard(c *gin.Context) {
	limit := 50
	if l, err := parseInt(c.Query("limit"), 50); err == nil && l > 0 && l <= 100 {
		limit = l
	}

	type RankEntry struct {
		UserID     int64  `json:"user_id"`
		Username   string `json:"username"`
		QuoteCount int64  `json:"quote_count"`
	}
	var results []RankEntry

	database.DB.Model(&model.Quote{}).
		Select("contributor_id AS user_id, COUNT(*) AS quote_count").
		Where("status = ?", "approved").
		Group("contributor_id").
		Order("quote_count DESC").
		Limit(limit).
		Scan(&results)

	// Enrich with usernames, handle anonymous (-1)
	type UserInfo struct {
		ID       uint
		Username string
	}
	var (
		userIDs   []uint
		anonCount int64
	)
	for _, r := range results {
		if r.UserID == -1 {
			anonCount += r.QuoteCount
			continue
		}
		userIDs = append(userIDs, uint(r.UserID))
	}
	userMap := make(map[uint]string)
	if len(userIDs) > 0 {
		var users []UserInfo
		database.DB.Model(&model.User{}).Where("id IN ?", userIDs).Find(&users)
		for _, u := range users {
			userMap[u.ID] = u.Username
		}
	}

	entries := make([]gin.H, 0)
	for i, r := range results {
		if r.UserID == -1 {
			entries = append(entries, gin.H{
				"rank":        i + 1,
				"user_id":     -1,
				"username":    "anonymous",
				"quote_count": r.QuoteCount,
			})
			continue
		}
		username := r.Username
		if userMap[uint(r.UserID)] != "" {
			username = userMap[uint(r.UserID)]
		}
		entries = append(entries, gin.H{
			"rank":        i + 1,
			"user_id":     r.UserID,
			"username":    username,
			"quote_count": r.QuoteCount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"leaderboard": entries})
}
