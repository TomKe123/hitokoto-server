package database

import (
	"fmt"
	"log"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/model"

	"github.com/glebarez/sqlite"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

var DB *gorm.DB

func Connect(cfg *config.Config) {
	var dialector gorm.Dialector

	switch cfg.DBDriver {
	case "mysql":
		dsn := fmt.Sprintf(
			"%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
			cfg.DBUser, cfg.DBPassword, cfg.DBHost, cfg.DBPort, cfg.DBName,
		)
		dialector = mysql.Open(dsn)
	case "sqlite":
		dialector = sqlite.Open(cfg.DBPath)
	default:
		log.Fatalf("Unsupported database driver: %s (supported: sqlite, mysql)", cfg.DBDriver)
	}

	var err error
	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Printf("Database connected successfully (driver: %s)", cfg.DBDriver)
}

func Migrate() {
	err := DB.AutoMigrate(
		&model.User{},
		&model.RefreshToken{},
		&model.Quote{},
		&model.Category{},
		&model.InviteCode{},
	)
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Set default status for existing records
	DB.Model(&model.User{}).Where("status = ''").Update("status", "active")
	DB.Model(&model.Quote{}).Where("status = ''").Update("status", "approved")

	log.Println("Database migration completed")
}

func Seed() {
	var count int64
	DB.Model(&model.User{}).Where("username = ?", "admin").Count(&count)
	if count > 0 {
		log.Println("Admin user already exists, skipping seed")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("admin123"), bcrypt.DefaultCost)
	if err != nil {
		log.Fatalf("Failed to hash admin password: %v", err)
	}

	admin := model.User{
		ID:           100000000,
		Username:     "admin",
		Email:        "admin@hitokoto.local",
		PasswordHash: string(hash),
		Role:         "admin",
		Status:       "active",
	}
	if err := DB.Create(&admin).Error; err != nil {
		log.Fatalf("Failed to create admin user: %v", err)
	}

	log.Println("Default admin user created (admin / admin123)")
}
