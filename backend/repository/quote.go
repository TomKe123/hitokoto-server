package repository

import (
	"strconv"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"gorm.io/gorm"
)

// --- Quote CRUD ---

func CreateQuote(q *model.Quote) error {
	return database.DB.Create(q).Error
}

func FindQuoteByUUIDOrID(id string) (*model.Quote, error) {
	var q model.Quote
	query := database.DB.Where("uuid = ?", id)
	// Only add ID-based lookup if id looks like a number
	if numID, err := strconv.ParseUint(id, 10, 64); err == nil {
		query = query.Or("id = ?", numID)
	}
	err := query.First(&q).Error
	if err != nil {
		return nil, err
	}
	return &q, nil
}

func UpdateQuote(id uint, updates map[string]interface{}) error {
	return database.DB.Model(&model.Quote{}).Where("id = ?", id).Updates(updates).Error
}

func ReloadQuote(q *model.Quote) error {
	return database.DB.First(q, q.ID).Error
}

func DeleteQuote(q *model.Quote) error {
	return database.DB.Delete(q).Error
}

func DeleteQuotesByUUIDs(uuids []string) (int64, error) {
	result := database.DB.Where("uuid IN ?", uuids).Delete(&model.Quote{})
	return result.RowsAffected, result.Error
}

func BatchUpdateQuoteStatus(uuids []string, status string) (int64, error) {
	result := database.DB.Model(&model.Quote{}).Where("uuid IN ?", uuids).Update("status", status)
	return result.RowsAffected, result.Error
}

func FindQuotesByUUIDs(uuids []string) ([]model.Quote, error) {
	var quotes []model.Quote
	err := database.DB.Where("uuid IN ?", uuids).Find(&quotes).Error
	return quotes, err
}

func ApproveAllRejected() (int64, error) {
	result := database.DB.Model(&model.Quote{}).Where("status = ?", "rejected").Update("status", "approved")
	return result.RowsAffected, result.Error
}

func QuoteExistsByUUID(uuid string) (bool, error) {
	var count int64
	err := database.DB.Model(&model.Quote{}).Where("uuid = ?", uuid).Count(&count).Error
	return count > 0, err
}

// --- Quote query builders (return *gorm.DB for further chaining) ---

func QuotesQuery() *gorm.DB {
	return database.DB.Model(&model.Quote{})
}

func ApprovedQuotesQuery() *gorm.DB {
	return database.DB.Model(&model.Quote{}).Where("status = ?", "approved")
}

// --- Quote stats ---

type QuoteStats struct {
	All, Pending, Approved, Rejected int64
}

func GetQuoteStats() (QuoteStats, error) {
	var s QuoteStats
	if err := database.DB.Model(&model.Quote{}).Count(&s.All).Error; err != nil {
		return s, err
	}
	if err := database.DB.Model(&model.Quote{}).Where("status = ?", "pending").Count(&s.Pending).Error; err != nil {
		return s, err
	}
	if err := database.DB.Model(&model.Quote{}).Where("status = ?", "approved").Count(&s.Approved).Error; err != nil {
		return s, err
	}
	if err := database.DB.Model(&model.Quote{}).Where("status = ?", "rejected").Count(&s.Rejected).Error; err != nil {
		return s, err
	}
	return s, nil
}

func CountApprovedByCategory(category string) (int64, error) {
	var count int64
	err := database.DB.Model(&model.Quote{}).Where("category = ? AND status = ?", category, "approved").Count(&count).Error
	return count, err
}

// CountApprovedByContributor counts approved quotes for a contributor.
func CountApprovedByContributor(contributorID int64) (int64, error) {
	var count int64
	err := database.DB.Model(&model.Quote{}).
		Where("contributor_id = ? AND status = ?", contributorID, "approved").
		Count(&count).Error
	return count, err
}

// CountNonRejectedByContributor counts non-rejected quotes for a contributor.
func CountNonRejectedByContributor(contributorID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&model.Quote{}).
		Where("contributor_id = ? AND status != ?", int64(contributorID), "rejected").
		Count(&count).Error
	return count, err
}

// --- Quote repairs ---

func FixOrphanedContributorIDs() int64 {
	// contributor_id = 0 is now the official source (官方源), so this is a no-op.
	// Previously fixed 0 → -1 (anonymous), which is no longer applicable.
	return 0
}

func ReassignCategoryQuotes(oldCategory, newCategory string) {
	database.DB.Model(&model.Quote{}).Where("category = ?", oldCategory).Update("category", newCategory)
}

// --- Category operations ---

func ListCategories() ([]model.Category, error) {
	var cats []model.Category
	err := database.DB.Find(&cats).Error
	return cats, err
}

func GetCategoryFallbackStats() ([]struct {
	Category string
	Count    int64
}, error) {
	var results []struct {
		Category string
		Count    int64
	}
	err := database.DB.Model(&model.Quote{}).
		Where("status = ?", "approved").
		Select("category, COUNT(*) as count").
		Group("category").
		Find(&results).Error
	return results, err
}

func CreateCategory(cat *model.Category) error {
	return database.DB.Create(cat).Error
}

func FindCategoryByID(id uint) (*model.Category, error) {
	var cat model.Category
	err := database.DB.First(&cat, id).Error
	if err != nil {
		return nil, err
	}
	return &cat, nil
}

func UpdateCategory(cat *model.Category, updates map[string]interface{}) error {
	return database.DB.Model(cat).Updates(updates).Error
}

func DeleteCategory(cat *model.Category) error {
	return database.DB.Delete(cat).Error
}
