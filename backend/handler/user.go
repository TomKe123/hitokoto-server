package handler

import (
	"net/http"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/database"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type UserHandler struct{}

func (h *UserHandler) GetProfile(c *gin.Context) {
	id := c.Param("id")
	requestUserID := c.GetUint("user_id")

	var user model.User
	if err := database.DB.First(&user, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	var quoteCount int64
	database.DB.Model(&model.Quote{}).Where("contributor_id = ?", user.ID).Count(&quoteCount)

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
	page := 1
	pageSize := 20

	if p, err := parseInt(c.Query("page"), 1); err == nil {
		page = p
	}
	if ps, err := parseInt(c.Query("page_size"), 20); err == nil {
		pageSize = ps
	}

	var total int64
	database.DB.Model(&model.Quote{}).Where("contributor_id = ?", id).Count(&total)

	var quotes []model.Quote
	offset := (page - 1) * pageSize
	database.DB.Where("contributor_id = ?", id).
		Order("created_at DESC").
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
