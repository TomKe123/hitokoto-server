package handler

import (
	"crypto/rand"
	"fmt"
	"os"
	"strings"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"
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

	preserve := map[string]string{
		"JWT_SECRET":        "",
		"JWT_REFRESH_SECRET": "",
		"SERVER_PORT":       "",
	}
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
				v = generateRandomSecret(60)
			case "JWT_REFRESH_SECRET":
				v = generateRandomSecret(60)
			case "SERVER_PORT":
				v = "8080"
			}
		}
	}

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

	existing, _ := repository.CountAdmins()
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
		Permissions:  permissions.PermAll,
	}
	if err := repository.CreateUser(&admin); err != nil {
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

func (h *SetupHandler) AdminStatus(c *gin.Context) {
	count, _ := repository.CountAdmins()
	c.JSON(200, gin.H{"exists": count > 0})
}

type ResetInput struct {
	KeepData bool `json:"keep_data"`
}

func (h *SetupHandler) Reset(c *gin.Context) {
	var input ResetInput
	if err := c.ShouldBindJSON(&input); err != nil {
		input.KeepData = false
	}

	jwtSecret := generateRandomSecret(60)
	jwtRefreshSecret := generateRandomSecret(60)

	data, err := os.ReadFile(".env")
	if err != nil {
		c.JSON(500, gin.H{"error": "Failed to read .env"})
		return
	}

	lines := strings.Split(string(data), "\n")
	var newLines []string
	jwtFound := false
	refreshFound := false
	for _, line := range lines {
		if strings.HasPrefix(line, "JWT_SECRET=") {
			newLines = append(newLines, fmt.Sprintf("JWT_SECRET=%s", jwtSecret))
			jwtFound = true
		} else if strings.HasPrefix(line, "JWT_REFRESH_SECRET=") {
			newLines = append(newLines, fmt.Sprintf("JWT_REFRESH_SECRET=%s", jwtRefreshSecret))
			refreshFound = true
		} else {
			newLines = append(newLines, line)
		}
	}
	if !jwtFound {
		newLines = append(newLines, fmt.Sprintf("JWT_SECRET=%s", jwtSecret))
	}
	if !refreshFound {
		newLines = append(newLines, fmt.Sprintf("JWT_REFRESH_SECRET=%s", jwtRefreshSecret))
	}

	if err := os.WriteFile(".env", []byte(strings.Join(newLines, "\n")), 0644); err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("Failed to save config: %v", err)})
		return
	}

	if err := setup.Reset(); err != nil {
		c.JSON(500, gin.H{"error": fmt.Sprintf("Failed to reset setup: %v", err)})
		return
	}

	if !input.KeepData {
		database.ResetTables()
	}

	c.JSON(200, gin.H{
		"message":   "Server reset successfully. Setup is required again.",
		"keep_data": input.KeepData,
	})
}

func generateRandomSecret(length int) string {
	const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	rand.Read(b)
	for i, v := range b {
		b[i] = chars[v%byte(len(chars))]
	}
	return string(b)
}

func (h *SetupHandler) Complete(c *gin.Context) {
	if !setup.Needed() {
		c.JSON(400, gin.H{"error": "Setup already completed"})
		return
	}

	count, _ := repository.CountAdmins()
	if count == 0 {
		c.JSON(400, gin.H{"error": "Admin user must be created first"})
		return
	}

	setup.MarkDone()
	c.JSON(200, gin.H{"message": "Setup complete"})
}
