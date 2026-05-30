package handler

import (
	"fmt"
	"os"
	"strings"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/setup"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type SetupHandler struct{}

type DatabaseConfigInput struct {
	Driver   string `json:"driver" binding:"required,oneof=sqlite mysql"`
	Host     string `json:"host"`
	Port     string `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
	DBName   string `json:"db_name"`
	DBPath   string `json:"db_path"`
}

func (h *SetupHandler) DatabaseConfig(c *gin.Context) {
	if !setup.Needed() {
		c.JSON(400, gin.H{"error": "Setup already completed"})
		return
	}

	var input DatabaseConfigInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(400, gin.H{"error": "Invalid input: driver must be sqlite or mysql"})
		return
	}

	var envConfig config.Config

	if input.Driver == "mysql" {
		if input.Host == "" {
			input.Host = "localhost"
		}
		if input.Port == "" {
			input.Port = "3306"
		}
		if input.User == "" {
			c.JSON(400, gin.H{"error": "MySQL user is required"})
			return
		}
		if input.DBName == "" {
			c.JSON(400, gin.H{"error": "MySQL database name is required"})
			return
		}

		// Reconnect to MySQL
		if err := database.ReconnectMySQL(input.Host, input.Port, input.User, input.Password, input.DBName); err != nil {
			c.JSON(400, gin.H{"error": fmt.Sprintf("Cannot connect to MySQL: %v", err)})
			return
		}

		envConfig.DBDriver = "mysql"
		envConfig.DBHost = input.Host
		envConfig.DBPort = input.Port
		envConfig.DBUser = input.User
		envConfig.DBPassword = input.Password
		envConfig.DBName = input.DBName
	} else {
		path := input.DBPath
		if path == "" {
			path = "hitokoto.db"
		}

		if err := database.ReconnectSQLite(path); err != nil {
			c.JSON(500, gin.H{"error": fmt.Sprintf("Cannot connect to SQLite: %v", err)})
			return
		}

		envConfig.DBDriver = "sqlite"
		envConfig.DBPath = path
	}

	// Preserve existing JWT_SECRET and SERVER_PORT if present
	preserve := map[string]string{"JWT_SECRET": "", "JWT_REFRESH_SECRET": "", "SERVER_PORT": ""}
	if data, err := os.ReadFile(".env"); err == nil {
		for _, line := range strings.Split(string(data), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) == 2 {
				key := strings.TrimSpace(parts[0])
				if _, ok := preserve[key]; ok {
					preserve[key] = strings.TrimSpace(parts[1])
				}
			}
		}
	}

	for k, v := range preserve {
		if v == "" {
			switch k {
			case "JWT_SECRET":
				v = "hitokoto-access-secret-key"
			case "JWT_REFRESH_SECRET":
				v = "hitokoto-refresh-secret-key"
			case "SERVER_PORT":
				v = "8080"
			}
		}
	}

	// Build .env content
	var envLines []string
	if input.Driver == "mysql" {
		envLines = append(envLines,
			"# Database",
			fmt.Sprintf("DB_DRIVER=mysql"),
			fmt.Sprintf("DB_HOST=%s", envConfig.DBHost),
			fmt.Sprintf("DB_PORT=%s", envConfig.DBPort),
			fmt.Sprintf("DB_USER=%s", envConfig.DBUser),
			fmt.Sprintf("DB_PASSWORD=%s", envConfig.DBPassword),
			fmt.Sprintf("DB_NAME=%s", envConfig.DBName),
		)
	} else {
		envLines = append(envLines,
			"# Database",
			fmt.Sprintf("DB_DRIVER=sqlite"),
			fmt.Sprintf("DB_PATH=%s", envConfig.DBPath),
		)
	}
	envLines = append(envLines,
		"",
		"# Server",
		fmt.Sprintf("SERVER_PORT=%s", preserve["SERVER_PORT"]),
		"",
		"# JWT",
		fmt.Sprintf("JWT_SECRET=%s", preserve["JWT_SECRET"]),
		fmt.Sprintf("JWT_REFRESH_SECRET=%s", preserve["JWT_REFRESH_SECRET"]),
		"",
	)

	if err := os.WriteFile(".env", []byte(strings.Join(envLines, "\n")), 0644); err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("Failed to save config: %v", err)})
		return
	}

	c.JSON(200, gin.H{
		"message": "Database configured",
		"driver":  input.Driver,
	})
}

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
