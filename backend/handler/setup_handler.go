package handler

import (
	"fmt"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/setup"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type SetupHandler struct{}

func (h *SetupHandler) Status(c *gin.Context) {
	c.JSON(200, gin.H{"needed": setup.Needed()})
}

type AdminSetupInput struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required,min=6"`
}

func (h *SetupHandler) CreateAdmin(c *gin.Context) {
	if !setup.Needed() {
		c.JSON(400, gin.H{"error": "Setup already completed"})
		return
	}

	var input AdminSetupInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": "Invalid input: username required, password min 6 characters"})
		return
	}

	var existing int64
	database.DB.Model(&model.User{}).Where("role = ?", "admin").Count(&existing)
	if existing > 0 {
		c.JSON(400, gin.H{"error": "Admin user already exists"})
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(input.Password), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to hash password"})
		return
	}

	admin := model.User{
		Username:     input.Username,
		Email:        input.Username + "@hitokoto.local",
		PasswordHash: string(hash),
		Role:         "admin",
		Status:       "active",
	}
	if err := database.DB.Create(&admin).Error; err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("Failed to create admin: %v", err)})
		return
	}

	c.JSON(200, gin.H{"message": "Admin user created", "username": input.Username})
}

type ImportResult struct {
	Total   int `json:"total"`
	Files   int `json:"files"`
	Skipped int `json:"skipped"`
}

func (h *SetupHandler) Import(c *gin.Context) {
	if !setup.Needed() {
		c.JSON(400, gin.H{"error": "Setup already completed"})
		return
	}

	go func() {
		setup.ImportFromCDN()
	}()

	c.JSON(202, gin.H{"message": "Import started in background"})
}

func (h *SetupHandler) ImportStatus(c *gin.Context) {
	setup.ImportFromCDN()
	c.JSON(200, gin.H{"message": "Import complete"})
}

func (h *SetupHandler) Complete(c *gin.Context) {
	if !setup.Needed() {
		c.JSON(400, gin.H{"error": "Setup already completed"})
		return
	}

	var adminCount int64
	database.DB.Model(&model.User{}).Where("role = ?", "admin").Count(&adminCount)
	if adminCount == 0 {
		c.JSON(400, gin.H{"error": "Admin user must be created first"})
		return
	}

	setup.MarkDone()
	c.JSON(200, gin.H{"message": "Setup complete"})
}
