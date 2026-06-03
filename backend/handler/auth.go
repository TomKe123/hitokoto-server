package handler

import (
	"net/http"
	"time"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/permissions"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type AuthHandler struct {
	Config *config.Config
}

type RegisterInput struct {
	Username   string `json:"username" binding:"required,min=3,max=50"`
	Email      string `json:"email"`
	Password   string `json:"password" binding:"required,min=8"`
	InviteCode string `json:"invite_code" binding:"required"`
}

type LoginInput struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password" binding:"required"`
}

func (h *AuthHandler) Register(c *gin.Context) {
	var input RegisterInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate invite code
	var inviteCode model.InviteCode
	if result := database.DB.Where("code = ?", input.InviteCode).First(&inviteCode); result.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite code"})
		return
	}
	if inviteCode.UseCount >= inviteCode.MaxUses {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invite code has been exhausted"})
		return
	}

	var existing model.User
	if result := database.DB.Where("username = ?", input.Username).First(&existing); result.Error == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username already exists"})
		return
	}

	if input.Email != "" {
		var existingEmail model.User
		if result := database.DB.Where("email = ?", input.Email).First(&existingEmail); result.Error == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
			return
		}
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	user := model.User{
		Username:     input.Username,
		Email:        input.Email,
		PasswordHash: string(hashedPassword),
		Role:         "user",
		Permissions:  permissions.PermUpload,
	}

	if err := database.DB.Create(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user"})
		return
	}

	// Mark invite code as used
	database.DB.Model(&inviteCode).Update("use_count", inviteCode.UseCount+1)

	c.JSON(http.StatusCreated, gin.H{
		"message": "user registered successfully",
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
		},
	})
}

func (h *AuthHandler) Login(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Username == "" && input.Email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username or email is required"})
		return
	}

	var user model.User
	var queryErr error

	if input.Username != "" {
		queryErr = database.DB.Where("username = ?", input.Username).First(&user).Error
	} else {
		queryErr = database.DB.Where("email = ?", input.Email).First(&user).Error
	}

	if queryErr != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(input.Password)); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid credentials"})
		return
	}

	if user.Status == "banned" {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is banned"})
		return
	}

	accessToken, err := middleware.GenerateAccessToken(h.Config, user.ID, user.Username, user.Role, user.Permissions)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate access token"})
		return
	}

	refreshToken, err := middleware.GenerateRefreshToken(h.Config, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate refresh token"})
		return
	}

	rt := model.RefreshToken{
		UserID:    user.ID,
		Token:     refreshToken,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	database.DB.Create(&rt)

	c.JSON(http.StatusOK, gin.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
		"user": gin.H{
			"id":       user.ID,
			"username": user.Username,
			"email":    user.Email,
			"role":         user.Role,
				"permissions":  user.Permissions,
		},
	})
}

func (h *AuthHandler) Refresh(c *gin.Context) {
	var input struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh_token is required"})
		return
	}

	userID, err := middleware.ValidateRefreshToken(h.Config, input.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired refresh token"})
		return
	}

	var stored model.RefreshToken
	if result := database.DB.Where("token = ? AND user_id = ?", input.RefreshToken, userID).First(&stored); result.Error != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "refresh token has been revoked"})
		return
	}

	database.DB.Delete(&stored)

	var user model.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	if user.Status == "banned" {
		c.JSON(http.StatusForbidden, gin.H{"error": "account is banned"})
		return
	}

	accessToken, err := middleware.GenerateAccessToken(h.Config, user.ID, user.Username, user.Role, user.Permissions)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate access token"})
		return
	}

	refreshToken, err := middleware.GenerateRefreshToken(h.Config, user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate refresh token"})
		return
	}

	rt := model.RefreshToken{
		UserID:    user.ID,
		Token:     refreshToken,
		ExpiresAt: time.Now().Add(7 * 24 * time.Hour),
	}
	database.DB.Create(&rt)

	c.JSON(http.StatusOK, gin.H{
		"access_token":  accessToken,
		"refresh_token": refreshToken,
	})
}

func (h *AuthHandler) Logout(c *gin.Context) {
	var input struct {
		RefreshToken string `json:"refresh_token" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refresh_token is required"})
		return
	}

	userID := c.GetUint("user_id")
	database.DB.Where("token = ? AND user_id = ?", input.RefreshToken, userID).Delete(&model.RefreshToken{})

	c.JSON(http.StatusOK, gin.H{"message": "logged out successfully"})
}

func (h *AuthHandler) GetMe(c *gin.Context) {
	userID := c.GetUint("user_id")

	var user model.User
	if err := database.DB.First(&user, userID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"user": gin.H{
			"id":         user.ID,
			"username":   user.Username,
			"email":      user.Email,
			"role":       user.Role,
				"permissions":  user.Permissions,
			"status":     user.Status,
			"created_at": user.CreatedAt,
		},
	})
}

func (h *AuthHandler) ValidateRefreshTokenHandler(c *gin.Context) {
	tokenStr := c.Param("token")
	userID, err := middleware.ValidateRefreshToken(h.Config, tokenStr)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid token"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"user_id": userID})
}
