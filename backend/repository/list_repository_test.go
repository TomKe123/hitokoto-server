package repository

import (
	"os"
	"testing"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

// setupTestDB creates an in-memory SQLite database for testing.
func setupTestDB(t *testing.T) *gorm.DB {
	_ = os.Setenv("DB_DRIVER", "sqlite")
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("failed to open test DB: %v", err)
	}
	// Migrate models
	err = db.AutoMigrate(
		&model.User{},
		&model.Quote{},
		&model.QuoteList{},
		&model.QuoteListItem{},
		&model.QuoteListReference{},
		&model.Category{},
	)
	if err != nil {
		t.Fatalf("failed to migrate test DB: %v", err)
	}
	// Store the DB in the package global
	database.DB = db
	// Also set config for any handler that needs it
	config.Load()
	return db
}

func createTestList(db *gorm.DB, t *testing.T, userID uint, name string, listType string) *model.QuoteList {
	list := model.QuoteList{
		Name:   name,
		UserID: userID,
		Type:   listType,
	}
	if err := db.Create(&list).Error; err != nil {
		t.Fatalf("failed to create test list: %v", err)
	}
	return &list
}

func createTestUser(db *gorm.DB, t *testing.T, username string) *model.User {
	user := model.User{
		Username: username,
	}
	if err := db.Create(&user).Error; err != nil {
		t.Fatalf("failed to create test user: %v", err)
	}
	return &user
}

// --- 7.1 Unit tests for circular reference detection ---

func TestHasReference_Direct(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")
	aggList := createTestList(db, t, user.ID, "Aggregated", "aggregated")
	normalList := createTestList(db, t, user.ID, "Normal", "normal")

	// No reference yet
	exists, err := HasReference(aggList.ID, normalList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if exists {
		t.Fatal("expected no direct reference initially")
	}

	// Create a reference
	_, err = CreateReference(aggList.ID, normalList.ID)
	if err != nil {
		t.Fatalf("failed to create reference: %v", err)
	}

	// Now check — should detect direct reference
	exists, err = HasReference(aggList.ID, normalList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !exists {
		t.Fatal("expected direct reference to be detected")
	}
}

func TestHasReference_Circular(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	// Create two aggregated lists
	aggA := createTestList(db, t, user.ID, "List A", "aggregated")
	aggB := createTestList(db, t, user.ID, "List B", "aggregated")

	// Add A -> B
	_, err := CreateReference(aggA.ID, aggB.ID)
	if err != nil {
		t.Fatalf("failed to create reference A->B: %v", err)
	}

	// Check: adding B -> A should be detected as circular
	circular, err := HasReference(aggB.ID, aggA.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !circular {
		t.Fatal("expected circular reference B->A to be detected (A references B)")
	}
}

func TestHasReference_DeepCircular(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	// Create a chain: A -> B -> C, then try C -> A
	aggA := createTestList(db, t, user.ID, "List A", "aggregated")
	aggB := createTestList(db, t, user.ID, "List B", "aggregated")
	aggC := createTestList(db, t, user.ID, "List C", "aggregated")

	_, _ = CreateReference(aggA.ID, aggB.ID)
	_, _ = CreateReference(aggB.ID, aggC.ID)

	circular, err := HasReference(aggC.ID, aggA.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !circular {
		t.Fatal("expected deep circular reference C->A to be detected (A->B->C)")
	}
}

func TestHasReference_NoCircular(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	aggList := createTestList(db, t, user.ID, "Aggregated", "aggregated")
	normalA := createTestList(db, t, user.ID, "Normal A", "normal")
	normalB := createTestList(db, t, user.ID, "Normal B", "normal")

	_, _ = CreateReference(aggList.ID, normalA.ID)

	// Adding a reference to a different normal list should NOT be circular
	circular, err := HasReference(aggList.ID, normalB.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if circular {
		t.Fatal("expected no circular reference when adding unrelated list")
	}
}

// --- 7.2 Unit tests for recursive quote collection ---

func TestGetReferencedListIDsRecursive_Simple(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	aggList := createTestList(db, t, user.ID, "Aggregated", "aggregated")
	normalList := createTestList(db, t, user.ID, "Normal", "normal")

	_, _ = CreateReference(aggList.ID, normalList.ID)

	refIDs, err := GetReferencedListIDsRecursive(aggList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(refIDs) != 1 {
		t.Fatalf("expected 1 referenced list, got %d", len(refIDs))
	}
	if refIDs[0] != normalList.ID {
		t.Fatalf("expected list ID %d, got %d", normalList.ID, refIDs[0])
	}
}

func TestGetReferencedListIDsRecursive_Nested(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	aggA := createTestList(db, t, user.ID, "Agg A", "aggregated")
	aggB := createTestList(db, t, user.ID, "Agg B", "aggregated")
	normal := createTestList(db, t, user.ID, "Normal", "normal")

	_, _ = CreateReference(aggA.ID, aggB.ID)
	_, _ = CreateReference(aggB.ID, normal.ID)

	refIDs, err := GetReferencedListIDsRecursive(aggA.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should include both the intermediate aggregated list and the leaf normal list
	if len(refIDs) != 2 {
		t.Fatalf("expected 2 referenced lists (aggB + normal), got %d", len(refIDs))
	}
}

func TestGetReferencedListIDsRecursive_MultipleLeaves(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	aggList := createTestList(db, t, user.ID, "Aggregated", "aggregated")
	normalA := createTestList(db, t, user.ID, "Normal A", "normal")
	normalB := createTestList(db, t, user.ID, "Normal B", "normal")

	_, _ = CreateReference(aggList.ID, normalA.ID)
	_, _ = CreateReference(aggList.ID, normalB.ID)

	refIDs, err := GetReferencedListIDsRecursive(aggList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(refIDs) != 2 {
		t.Fatalf("expected 2 referenced lists, got %d", len(refIDs))
	}
}

func TestGetReferencedListIDsRecursive_Empty(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	aggList := createTestList(db, t, user.ID, "Empty Agg", "aggregated")

	refIDs, err := GetReferencedListIDsRecursive(aggList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(refIDs) != 0 {
		t.Fatalf("expected 0 referenced lists for empty aggregated list, got %d", len(refIDs))
	}
}

func TestGetReferencedListIDsRecursive_Circular(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	// A -> B -> A (circular)
	aggA := createTestList(db, t, user.ID, "Agg A", "aggregated")
	aggB := createTestList(db, t, user.ID, "Agg B", "aggregated")

	_, _ = CreateReference(aggA.ID, aggB.ID)
	_, _ = CreateReference(aggB.ID, aggA.ID)

	// Should not loop forever — visited set prevents re-traversal
	refIDs, err := GetReferencedListIDsRecursive(aggA.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should include B (A->B), but A is already visited so no A->A
	if len(refIDs) != 1 {
		t.Fatalf("expected 1 referenced list (B), got %d", len(refIDs))
	}
	if refIDs[0] != aggB.ID {
		t.Fatalf("expected list ID %d, got %d", aggB.ID, refIDs[0])
	}
}

// --- 7.3 API integration tests for reference management ---

func TestCreateReference_Duplicate(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")
	aggList := createTestList(db, t, user.ID, "Agg", "aggregated")
	normalList := createTestList(db, t, user.ID, "Normal", "normal")

	_, err := CreateReference(aggList.ID, normalList.ID)
	if err != nil {
		t.Fatalf("failed to create first reference: %v", err)
	}

	// Creating the same reference should fail (unique constraint)
	_, err = CreateReference(aggList.ID, normalList.ID)
	if err == nil {
		t.Fatal("expected error for duplicate reference, got nil")
	}
}

func TestDeleteReference_NotFound(t *testing.T) {
	setupTestDB(t)

	err := DeleteReference(99999)
	if err == nil {
		t.Fatal("expected error for deleting non-existent reference, got nil")
	}
	if err.Error() != "reference not found" {
		t.Fatalf("expected 'reference not found' error, got: %v", err)
	}
}

func TestGetReferencesByListID_Empty(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")
	aggList := createTestList(db, t, user.ID, "Agg", "aggregated")

	refs, err := GetReferencesByListID(aggList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(refs) != 0 {
		t.Fatalf("expected 0 references, got %d", len(refs))
	}
}

func TestUpdateReferenceCount(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")
	aggList := createTestList(db, t, user.ID, "Agg", "aggregated")
	normalList := createTestList(db, t, user.ID, "Normal", "normal")

	// Reference count should be 0 initially
	err := UpdateReferenceCount(normalList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var refreshedList model.QuoteList
	db.First(&refreshedList, normalList.ID)
	if refreshedList.ReferenceCount != 0 {
		t.Fatalf("expected reference_count 0, got %d", refreshedList.ReferenceCount)
	}

	// Create a reference and update count
	_, _ = CreateReference(aggList.ID, normalList.ID)
	err = UpdateReferenceCount(normalList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	db.First(&refreshedList, normalList.ID)
	if refreshedList.ReferenceCount != 1 {
		t.Fatalf("expected reference_count 1, got %d", refreshedList.ReferenceCount)
	}
}

func TestHasReferencesByTargetListID(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")
	aggList := createTestList(db, t, user.ID, "Agg", "aggregated")
	normalList := createTestList(db, t, user.ID, "Normal", "normal")

	has, err := HasReferencesByTargetListID(normalList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if has {
		t.Fatal("expected no references initially")
	}

	_, _ = CreateReference(aggList.ID, normalList.ID)
	has, err = HasReferencesByTargetListID(normalList.ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !has {
		t.Fatal("expected references to be detected after creation")
	}
}

// --- 7.4 Test pagination with aggregated lists ---

func TestGetReferencedListIDsRecursive_MaxDepth(t *testing.T) {
	db := setupTestDB(t)
	user := createTestUser(db, t, "testuser")

	// Create a chain: L0 -> L1 -> L2 -> L3 -> L4 -> L5
	lists := make([]*model.QuoteList, 6)
	for i := 0; i < 6; i++ {
		lists[i] = createTestList(db, t, user.ID, "Chain", "aggregated")
	}
	for i := 0; i < 5; i++ {
		_, _ = CreateReference(lists[i].ID, lists[i+1].ID)
	}

	refIDs, err := GetReferencedListIDsRecursive(lists[0].ID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(refIDs) != 5 {
		t.Fatalf("expected 5 referenced lists (L1-L5), got %d", len(refIDs))
	}
}
