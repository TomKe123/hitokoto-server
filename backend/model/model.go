package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	Username           string    `gorm:"uniqueIndex;size:50;not null" json:"username"`
	Email              string    `gorm:"uniqueIndex;size:100;not null" json:"email"`
	PasswordHash       string    `gorm:"size:255;not null" json:"-"`
	Role         string    `gorm:"size:20;not null;default:user" json:"role"`
	Status       string    `gorm:"size:20;not null;default:active;index" json:"status"`
	LastCodeGeneratedAt *time.Time `json:"last_code_generated_at"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

type InviteCode struct {
	ID        uint          `gorm:"primaryKey" json:"id"`
	Code      string        `gorm:"uniqueIndex;size:255;not null" json:"code"`
	MaxUses   int           `gorm:"not null;default:1" json:"max_uses"`
	UseCount  int           `gorm:"not null;default:0" json:"use_count"`
	CreatedBy uint          `gorm:"not null" json:"created_by"`
	ExpiresAt *time.Time    `json:"expires_at"`
	CreatedAt time.Time     `json:"created_at"`
	DeletedAt gorm.DeletedAt `gorm:"index" json:"-"`
}

type RefreshToken struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	Token     string    `gorm:"uniqueIndex;size:500;not null" json:"token"`
	ExpiresAt time.Time `gorm:"not null" json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}

type Quote struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	UUID          string    `gorm:"uniqueIndex;size:36;not null" json:"uuid"`
	Content       string    `gorm:"type:text;not null" json:"content"`
	From          string    `gorm:"size:255" json:"from"`
	Category      string    `gorm:"size:50;index;not null" json:"category"`
	Source        string    `gorm:"size:255" json:"source"`
	ContributorID uint      `gorm:"index;not null" json:"contributor_id"`
	Status        string    `gorm:"size:20;not null;default:pending;index" json:"status"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Notification struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	UserID    uint      `gorm:"index;not null" json:"user_id"`
	QuoteUUID string    `gorm:"size:36;not null" json:"quote_uuid"`
	Type      string    `gorm:"size:20;not null" json:"type"`
	Title     string    `gorm:"size:255;not null" json:"title"`
	Content   string    `gorm:"size:500;not null" json:"content"`
	IsRead    bool      `gorm:"not null;default:false" json:"is_read"`
	CreatedAt time.Time `json:"created_at"`
}

type Category struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Name      string    `gorm:"uniqueIndex;size:50;not null" json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type Setting struct {
	ID    uint   `gorm:"primaryKey" json:"id"`
	Key   string `gorm:"uniqueIndex;size:100;not null" json:"key"`
	Value string `gorm:"size:255;not null" json:"value"`
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == 0 {
		var maxID uint
		tx.Model(&User{}).Select("COALESCE(MAX(id), 99999999)").Scan(&maxID)
		u.ID = maxID + 1
		if u.ID < 100000000 {
			u.ID = 100000000
		}
	}
	return nil
}

func (q *Quote) BeforeCreate(tx *gorm.DB) error {
	if q.UUID == "" {
		q.UUID = uuid.New().String()
	}
	return nil
}
