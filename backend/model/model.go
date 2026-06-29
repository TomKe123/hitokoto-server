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
	Category      string    `gorm:"size:50;index;not null" json:"category"` // primary category (first of the set); full set lives in QuoteCategory
	Source        string    `gorm:"size:255" json:"source"`
	ContributorID int64     `gorm:"index;not null" json:"contributor_id"`
	Status        string    `gorm:"size:20;not null;default:pending;index" json:"status"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// QuoteCategory is the junction table holding the full set of categories for a
// quote. Quote.Category mirrors the primary (first) category for backward
// compatibility; this table is the authoritative source of the full set.
type QuoteCategory struct {
	ID        uint      `gorm:"primaryKey" json:"id"`
	QuoteID   uint      `gorm:"not null;uniqueIndex:idx_quote_category" json:"quote_id"`
	Category  string    `gorm:"size:50;not null;index;uniqueIndex:idx_quote_category" json:"category"`
	CreatedAt time.Time `json:"created_at"`
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
	ID               uint           `gorm:"primaryKey" json:"id"`
	UUID             string         `gorm:"uniqueIndex;size:36;not null" json:"uuid"`
	Name             string         `gorm:"size:255;not null" json:"name"`
	Description      string         `gorm:"size:1000" json:"description"`
	IsPublic         bool           `gorm:"not null" json:"is_public"`
	APIKeyHash       string         `gorm:"size:64" json:"-"`
	UserID           uint           `gorm:"index;not null" json:"user_id"`
	OrganizationID   *uint          `gorm:"index" json:"organization_id"`
	ShareType        string         `gorm:"size:20;not null;default:public" json:"share_type"` // public, organization_private, organization_public
	ItemCount        int            `gorm:"not null;default:0" json:"item_count"`
	Type             string         `gorm:"size:20;not null;default:normal" json:"type"`
	ReferenceCount   int            `gorm:"not null;default:0" json:"reference_count"`
	Blocked          bool           `gorm:"not null;default:false" json:"blocked"`
	BlockedReason    string         `gorm:"size:500" json:"blocked_reason"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        time.Time      `json:"updated_at"`
	DeletedAt        gorm.DeletedAt `gorm:"index" json:"-"`
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

type Organization struct {
	ID          uint           `gorm:"primaryKey" json:"id"`
	UUID        string         `gorm:"uniqueIndex;size:36;not null" json:"uuid"`
	Name        string         `gorm:"size:100;not null;uniqueIndex" json:"name"`
	Description string         `gorm:"size:500" json:"description"`
	Avatar      string         `gorm:"size:255" json:"avatar"`
	OwnerID     uint           `gorm:"not null" json:"owner_id"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index" json:"-"`
}

func (o *Organization) BeforeCreate(tx *gorm.DB) error {
	if o.UUID == "" {
		o.UUID = uuid.New().String()
	}
	return nil
}

type OrganizationMember struct {
	ID             uint           `gorm:"primaryKey" json:"id"`
	OrganizationID uint           `gorm:"index;not null" json:"organization_id"`
	UserID         uint           `gorm:"index;not null" json:"user_id"`
	Role           string         `gorm:"size:20;not null;default:member" json:"role"` // owner, admin, member
	CreatedAt      time.Time      `json:"created_at"`
	UpdatedAt      time.Time      `json:"updated_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
}

type OrganizationInvite struct {
	ID             uint      `gorm:"primaryKey" json:"id"`
	OrganizationID uint      `gorm:"index;not null" json:"organization_id"`
	Code           string    `gorm:"uniqueIndex;size:255;not null" json:"code"`
	CreatedBy      uint      `gorm:"not null" json:"created_by"`
	TargetUserID   *uint     `gorm:"index" json:"target_user_id"` // non-nil = direct user invite (no code needed)
	MaxUses        int       `gorm:"not null;default:1" json:"max_uses"`
	UseCount       int       `gorm:"not null;default:0" json:"use_count"`
	ExpiresAt      *time.Time `json:"expires_at"`
	CreatedAt      time.Time `json:"created_at"`
	DeletedAt      gorm.DeletedAt `gorm:"index" json:"-"`
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

// AICategorySuggestion stores AI-proposed new categories for admin review.
// Kept for backwards-compatibility; new code uses AIClassifyChange.
type AICategorySuggestion struct {
	ID                   uint      `gorm:"primaryKey" json:"id"`
	QuoteID              uint      `gorm:"index" json:"quote_id"`
	QuoteUUID            string    `gorm:"size:36;index" json:"quote_uuid"`
	SuggestedName        string    `gorm:"size:50" json:"suggested_name"`
	SuggestedDisplayName string    `gorm:"size:50" json:"suggested_display_name"`
	Reason               string    `gorm:"size:200" json:"reason"`
	Status               string    `gorm:"size:20;not null;default:pending;index" json:"status"` // pending/approved/rejected
	CreatedAt            time.Time `json:"created_at"`
	UpdatedAt            time.Time `json:"updated_at"`
}

// AIClassifySuggestionItem is one item inside AIClassifyChange.Suggestions (stored as JSON).
type AIClassifySuggestionItem struct {
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	IsNew       bool   `json:"is_new"`
	Confidence  string `json:"confidence"`
	Reason      string `json:"reason"`
}

// AIClassifyChange records one AI classification decision for a quote.
// All changes require human review before the Quote.Category is updated.
type AIClassifyChange struct {
	ID          uint      `gorm:"primaryKey" json:"id"`
	QuoteID     uint      `gorm:"index;not null" json:"quote_id"`
	QuoteUUID   string    `gorm:"size:36;index;not null" json:"quote_uuid"`
	QuoteContent string   `gorm:"type:text" json:"quote_content"` // snapshot for review page
	QuoteFrom   string    `gorm:"size:255" json:"quote_from"`
	OldCategory string    `gorm:"size:50" json:"old_category"`
	// Suggestions is a JSON array of AIClassifySuggestionItem.
	// The first item is the primary suggestion (highest confidence).
	Suggestions string    `gorm:"type:text;not null" json:"suggestions"`
	// Primary fields extracted from suggestions[0] for easy filtering/display
	NewCategory string    `gorm:"size:50;index" json:"new_category"`
	IsNew       bool      `gorm:"not null;default:false" json:"is_new"` // true if NewCategory doesn't exist yet
	Status      string    `gorm:"size:20;not null;default:pending;index" json:"status"` // pending/approved/rejected/skipped
	BatchRun    string    `gorm:"size:36;index" json:"batch_run"` // UUID of the batch job
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}
