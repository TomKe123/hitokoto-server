package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type User struct {
	ID                 uint      `gorm:"primaryKey" json:"id"`
	Username           string    `gorm:"uniqueIndex;size:50;not null" json:"username"`
	Email              string    `gorm:"size:100" json:"email"`
	PasswordHash       string    `gorm:"size:255;not null" json:"-"`
	Role               string    `gorm:"size:20;not null;default:user" json:"role"`
	Permissions        uint64    `gorm:"not null;default:0" json:"permissions"`
	Status             string    `gorm:"size:20;not null;default:active;index" json:"status"`
	LastCodeGeneratedAt *time.Time `json:"last_code_generated_at"`
	CreatedAt          time.Time `json:"created_at"`
	UpdatedAt          time.Time `json:"updated_at"`
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
	ContributorID int64     `gorm:"index;not null" json:"contributor_id"`
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
	ID          uint      `gorm:"primaryKey" json:"id"`
	Name        string    `gorm:"uniqueIndex;size:50;not null" json:"name"`
	DisplayName string    `gorm:"size:50" json:"display_name"`
	CreatedAt   time.Time `json:"created_at"`
}

type Setting struct {
	ID    uint   `gorm:"primaryKey" json:"id"`
	Key   string `gorm:"uniqueIndex;size:100" json:"key"`
	Value string `gorm:"size:255;not null" json:"value"`
}

type SeenQuote struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	Token     string    `gorm:"index;size:36;not null" json:"token"`
	QuoteUUID string    `gorm:"index;size:36;not null" json:"quote_uuid"`
	CreatedAt time.Time `json:"created_at"`
}

type QuoteList struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	UUID           string    `gorm:"uniqueIndex;size:36;not null" json:"uuid"`
	Name           string    `gorm:"size:255;not null" json:"name"`
	Description    string    `gorm:"size:1000" json:"description"`
	IsPublic       bool      `gorm:"not null" json:"is_public"`
	APIKeyHash     string    `gorm:"size:64" json:"-"`
	UserID         uint      `gorm:"index;not null" json:"user_id"`
	ItemCount      int       `gorm:"not null;default:0" json:"item_count"`
	Type           string    `gorm:"size:20;not null;default:normal" json:"type"`
	ReferenceCount int       `gorm:"not null;default:0" json:"reference_count"`
	Blocked        bool      `gorm:"not null;default:false" json:"blocked"`
	BlockedReason  string    `gorm:"size:500" json:"blocked_reason"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

type QuoteListItem struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	ListID    uint      `gorm:"index;not null" json:"list_id"`
	QuoteID   uint      `gorm:"not null" json:"quote_id"`
	SortOrder int       `gorm:"not null;default:0" json:"sort_order"`
	CreatedAt time.Time `json:"created_at"`
}

type QuoteListReference struct {
	ID            uint      `gorm:"primaryKey" json:"id"`
	SourceListID  uint      `gorm:"uniqueIndex:idx_source_target;not null" json:"source_list_id"`
	TargetListID  uint      `gorm:"uniqueIndex:idx_source_target;not null" json:"target_list_id"`
	CreatedAt     time.Time `json:"created_at"`
}

func (ql *QuoteList) BeforeCreate(tx *gorm.DB) error {
	if ql.UUID == "" {
		ql.UUID = uuid.New().String()
	}
	return nil
}

func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == 0 {
		var maxUser User
		tx.Model(&User{}).Order("id DESC").Limit(1).Find(&maxUser)
		u.ID = maxUser.ID + 1
		if maxUser.ID == 0 {
			u.ID = 100000000
		}
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
