package service

import (
	"os"
	"testing"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupReviewTestDB creates an in-memory SQLite DB with the models the review
// decision logic touches.
func setupReviewTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	_ = os.Setenv("DB_DRIVER", "sqlite")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open test DB: %v", err)
	}
	if err := db.AutoMigrate(&model.Quote{}, &model.Notification{}, &model.AIReviewChange{}); err != nil {
		t.Fatalf("failed to migrate test DB: %v", err)
	}
	database.DB = db
	return db
}

func newPendingQuote(t *testing.T, db *gorm.DB, contributorID int64) model.Quote {
	t.Helper()
	q := model.Quote{UUID: "u-" + t.Name(), Content: "测试语录", Category: "other", ContributorID: contributorID, Status: "pending"}
	if err := db.Create(&q).Error; err != nil {
		t.Fatalf("create quote: %v", err)
	}
	return q
}

func quoteStatus(t *testing.T, db *gorm.DB, id uint) string {
	t.Helper()
	var q model.Quote
	if err := db.First(&q, id).Error; err != nil {
		t.Fatalf("reload quote: %v", err)
	}
	return q.Status
}

func TestApplyReviewDecision_ApproveMeetsThreshold(t *testing.T) {
	db := setupReviewTestDB(t)
	q := newPendingQuote(t, db, 1)
	ch := &model.AIReviewChange{QuoteID: q.ID, Approved: true, Confidence: "high"}

	status, applied := applyReviewDecision(ch, confidenceRank("medium"), false)
	if !applied || status != "approved" {
		t.Fatalf("expected approved/applied, got status=%q applied=%v", status, applied)
	}
	if got := quoteStatus(t, db, q.ID); got != "approved" {
		t.Fatalf("quote status = %q, want approved", got)
	}
}

func TestApplyReviewDecision_BelowThreshold(t *testing.T) {
	db := setupReviewTestDB(t)
	q := newPendingQuote(t, db, 1)
	ch := &model.AIReviewChange{QuoteID: q.ID, Approved: true, Confidence: "low"}

	status, applied := applyReviewDecision(ch, confidenceRank("high"), false)
	if applied || status != "" {
		t.Fatalf("expected not applied, got status=%q applied=%v", status, applied)
	}
	if got := quoteStatus(t, db, q.ID); got != "pending" {
		t.Fatalf("quote status = %q, want pending", got)
	}
}

func TestApplyReviewDecision_RejectNotAllowed(t *testing.T) {
	db := setupReviewTestDB(t)
	q := newPendingQuote(t, db, 1)
	ch := &model.AIReviewChange{QuoteID: q.ID, Approved: false, Confidence: "high"}

	status, applied := applyReviewDecision(ch, confidenceRank("high"), false)
	if applied || status != "" {
		t.Fatalf("expected reject withheld, got status=%q applied=%v", status, applied)
	}
	if got := quoteStatus(t, db, q.ID); got != "pending" {
		t.Fatalf("quote status = %q, want pending", got)
	}
}

func TestApplyReviewDecision_RejectAllowedNotifies(t *testing.T) {
	db := setupReviewTestDB(t)
	q := newPendingQuote(t, db, 7)
	ch := &model.AIReviewChange{QuoteID: q.ID, Approved: false, Confidence: "high", Reason: "含攻击性言论"}

	status, applied := applyReviewDecision(ch, confidenceRank("high"), true)
	if !applied || status != "rejected" {
		t.Fatalf("expected rejected/applied, got status=%q applied=%v", status, applied)
	}
	if got := quoteStatus(t, db, q.ID); got != "rejected" {
		t.Fatalf("quote status = %q, want rejected", got)
	}
	var notifCount int64
	db.Model(&model.Notification{}).Where("user_id = ?", 7).Count(&notifCount)
	if notifCount != 1 {
		t.Fatalf("expected 1 rejection notification, got %d", notifCount)
	}
}

func TestApplyReviewDecision_RejectAnonymousNoNotify(t *testing.T) {
	db := setupReviewTestDB(t)
	q := newPendingQuote(t, db, -1) // anonymous contributor
	ch := &model.AIReviewChange{QuoteID: q.ID, Approved: false, Confidence: "high"}

	status, applied := applyReviewDecision(ch, confidenceRank("high"), true)
	if !applied || status != "rejected" {
		t.Fatalf("expected rejected/applied, got status=%q applied=%v", status, applied)
	}
	var notifCount int64
	db.Model(&model.Notification{}).Count(&notifCount)
	if notifCount != 0 {
		t.Fatalf("expected no notification for anonymous contributor, got %d", notifCount)
	}
}
