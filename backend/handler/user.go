package handler

import (
	"net/http"
	"time"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct{}

func (h *UserHandler) GetProfile(c *gin.Context) {
	id := c.Param("id")

	if id == "-1" {
		quoteCount, _ := repository.CountApprovedByContributor(-1)
		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"id":          -1,
				"username":    "anonymous",
				"quote_count": quoteCount,
			},
		})
		return
	}

	if id == "0" {
		quoteCount, _ := repository.CountApprovedByContributor(0)
		c.JSON(http.StatusOK, gin.H{
			"user": gin.H{
				"id":          0,
				"username":    "官方源",
				"quote_count": quoteCount,
			},
		})
		return
	}

	requestUserID := c.GetUint("user_id")

	user, err := repository.FindUserByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var quoteCount int64
	if user.ID == requestUserID {
		quoteCount, _ = repository.CountNonRejectedByContributor(user.ID)
	} else {
		quoteCount, _ = repository.CountApprovedByContributor(int64(user.ID))
	}

	resp := gin.H{
		"id":          user.ID,
		"username":    user.Username,
		"quote_count": quoteCount,
		"created_at":  user.CreatedAt,
	}

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

	query := repository.QuotesQuery().Where("contributor_id = ?", id)
	if id != "-1" && id != "0" && requestUserID == parseUint(id) {
		if status := c.Query("status"); status != "" {
			query = query.Where("status = ?", status)
		}
	} else {
		query = query.Where("status = ?", "approved")
	}

	var total int64
	query.Count(&total)

	var quotes []model.Quote
	offset := (page - 1) * pageSize
	query.Order("created_at DESC").
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
		exists, _ := repository.UsernameExistsExcluding(input.Username, userID)
		if exists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "username already exists"})
			return
		}
		updates["username"] = input.Username
	}
	if input.Email != "" {
		exists, _ := repository.EmailExistsExcluding(input.Email, userID)
		if exists {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
			return
		}
		updates["email"] = input.Email
	}

	if len(updates) > 0 {
		repository.UpdateUserByID(userID, updates)
	}

	user, err := repository.FindUserByID(userID)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

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

	user, err := repository.FindUserByID(userID)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.OldPassword)); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "old password is incorrect"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	repository.UpdateUserField(user, "password_hash", string(hashedPassword))
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

	user, err := repository.FindUserByID(userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if user.LastCodeGeneratedAt != nil {
		elapsed := time.Since(*user.LastCodeGeneratedAt)
		cooldown := 72 * time.Hour
		if elapsed < cooldown {
			remaining := cooldown - elapsed
			c.JSON(http.StatusTooManyRequests, gin.H{
				"error":           "请等待 " + remaining.Round(time.Second).String() + " 后再次生成",
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
	if err := repository.CreateInviteCode(&code); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "生成邀请码失败，可能该代码已存在"})
		return
	}

	now := time.Now()
	repository.UpdateUserField(user, "last_code_generated_at", &now)

	resp := gin.H{
		"id":         code.ID,
		"code":       code.Code,
		"max_uses":   code.MaxUses,
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

	total, _ := repository.CountUserInviteCodes(userID)

	offset := (page - 1) * pageSize
	codes, _ := repository.ListUserInviteCodes(userID, offset, pageSize)

	user, err := repository.FindUserByID(userID)
	if err != nil || user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

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

	repository.ApprovedQuotesQuery().
		Select("contributor_id AS user_id, COUNT(*) AS quote_count").
		Group("contributor_id").
		Order("quote_count DESC").
		Limit(limit).
		Scan(&results)

	var (
		userIDs   []uint
		anonCount int64
	)
	for _, r := range results {
		if r.UserID == -1 {
			anonCount += r.QuoteCount
			continue
		}
		if r.UserID == 0 {
			continue
		}
		userIDs = append(userIDs, uint(r.UserID))
	}
	userMap := make(map[uint]string)
	if len(userIDs) > 0 {
		users, _ := repository.FindUsersByIDs(userIDs)
		for _, u := range users {
			userMap[u.ID] = u.Username
		}
	}

	entries := make([]gin.H, 0)
	rank := 0
	for _, r := range results {
		if r.UserID == -1 {
			rank++
			entries = append(entries, gin.H{
				"rank":        rank,
				"user_id":     -1,
				"username":    "anonymous",
				"quote_count": r.QuoteCount,
			})
			continue
		}
		if r.UserID == 0 {
			continue
		}
		rank++
		username := r.Username
		if userMap[uint(r.UserID)] != "" {
			username = userMap[uint(r.UserID)]
		}
		entries = append(entries, gin.H{
			"rank":        rank,
			"user_id":     r.UserID,
			"username":    username,
			"quote_count": r.QuoteCount,
		})
	}

	c.JSON(http.StatusOK, gin.H{"leaderboard": entries})
}
