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
		Logger: logger.Default.LogMode(logger.Error),
	})
	if err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}

	log.Printf("Database connected successfully (driver: %s)", cfg.DBDriver)
}

// ReconnectMySQL closes the existing connection and connects to MySQL.
func ReconnectMySQL(host, port, user, password, dbName string) error {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?charset=utf8mb4&parseTime=True&loc=Local",
		user, password, host, port, dbName)
	return reconnect(mysql.Open(dsn))
}

// ReconnectSQLite closes the existing connection and connects to SQLite.
func ReconnectSQLite(dbPath string) error {
	return reconnect(sqlite.Open(dbPath))
}

func reconnect(dialector gorm.Dialector) error {
	if DB != nil {
		sqlDB, err := DB.DB()
		if err == nil {
			sqlDB.Close()
		}
	}

	var err error
	DB, err = gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Error),
	})
	if err != nil {
		return err
	}

	Migrate()
	log.Println("Database reconnected successfully")
	return nil
}

func Migrate() {
	err := DB.AutoMigrate(
		&model.User{},
		&model.RefreshToken{},
		&model.Quote{},
		&model.Category{},
		&model.InviteCode{},
		&model.Setting{},
		&model.Notification{},
		&model.SeenQuote{},
		&model.QuoteList{},
		&model.QuoteListItem{},
		&model.QuoteListReference{},
	)
	if err != nil {
		log.Fatalf("Failed to migrate database: %v", err)
	}

	// Set default status for existing records
	DB.Model(&model.User{}).Where("status = ''").Update("status", "active")
	DB.Model(&model.Quote{}).Where("status = ''").Update("status", "approved")

	// Drop unique index on email (allows multiple users without email)
	if DB.Migrator().HasIndex(&model.User{}, "idx_users_email") {
		DB.Migrator().DropIndex(&model.User{}, "idx_users_email")
	}
	// Seed default categories
	defaultCategories := []struct {
		Name        string
		DisplayName string
	}{
		{"anime", "动画"},
		{"comic", "漫画"},
		{"novel", "小说"},
		{"game", "游戏"},
		{"movie", "电影"},
		{"music", "音乐"},
		{"poetry", "诗词"},
		{"philosophy", "哲学"},
		{"life", "人生"},
		{"emotion", "情感"},
		{"dialogue", "台词"},
		{"other", "其他"},
	}
	for _, dc := range defaultCategories {
		var cat model.Category
		if err := DB.Where("name = ?", dc.Name).First(&cat).Error; err != nil {
			DB.Create(&model.Category{Name: dc.Name, DisplayName: dc.DisplayName})
		} else if cat.DisplayName == "" {
			DB.Model(&cat).Update("display_name", dc.DisplayName)
		}
	}

	log.Println("Database migration completed")
}

func ResetTables() {
	DB.Migrator().DropTable(
		&model.User{},
		&model.RefreshToken{},
		&model.Quote{},
		&model.Category{},
		&model.InviteCode{},
		&model.Setting{},
		&model.Notification{},
		&model.SeenQuote{},
		&model.QuoteList{},
		&model.QuoteListItem{},
		&model.QuoteListReference{},
	)
	Migrate()
	log.Println("Database tables reset completed")
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
