package repository

import (
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
)

// ─── AICategorySuggestion (legacy) ───────────────────────────────────────────

func CreateAISuggestion(s *model.AICategorySuggestion) error {
	return database.DB.Create(s).Error
}

func ListAISuggestions(status string, limit int) ([]model.AICategorySuggestion, error) {
	var list []model.AICategorySuggestion
	q := database.DB.Model(&model.AICategorySuggestion{})
	if status != "" {
		q = q.Where("status = ?", status)
	}
	if limit > 0 {
		q = q.Limit(limit)
	}
	err := q.Order("created_at DESC").Find(&list).Error
	return list, err
}

func FindAISuggestionByID(id uint) (*model.AICategorySuggestion, error) {
	var s model.AICategorySuggestion
	err := database.DB.First(&s, id).Error
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func UpdateAISuggestionStatus(s *model.AICategorySuggestion, status string) error {
	return database.DB.Model(s).Update("status", status).Error
}

func HasPendingAISuggestion(quoteID uint) bool {
	var count int64
	database.DB.Model(&model.AICategorySuggestion{}).
		Where("quote_id = ? AND status = ?", quoteID, "pending").
		Count(&count)
	return count > 0
}

// ─── AIClassifyChange ─────────────────────────────────────────────────────────

func CreateAIChange(c *model.AIClassifyChange) error {
	return database.DB.Create(c).Error
}

func FindAIChangeByID(id uint) (*model.AIClassifyChange, error) {
	var c model.AIClassifyChange
	if err := database.DB.First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

type AIChangeFilter struct {
	Status   string
	BatchRun string
	Page     int
	PageSize int
}

func ListAIChanges(f AIChangeFilter) ([]model.AIClassifyChange, int64, error) {
	q := database.DB.Model(&model.AIClassifyChange{})
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.BatchRun != "" {
		q = q.Where("batch_run = ?", f.BatchRun)
	}

	var total int64
	q.Count(&total)

	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 || f.PageSize > 200 {
		f.PageSize = 50
	}

	var list []model.AIClassifyChange
	err := q.Order("created_at DESC").
		Offset((f.Page - 1) * f.PageSize).
		Limit(f.PageSize).
		Find(&list).Error
	return list, total, err
}

func UpdateAIChangeStatus(c *model.AIClassifyChange, status string) error {
	return database.DB.Model(c).Update("status", status).Error
}

// UpdateAIChangeSuggestions replaces the AI suggestion data of a change in place
// (used when an admin asks the AI to re-judge a pending change). It keeps the
// change pending, clears any batch association, and refreshes updated_at.
func UpdateAIChangeSuggestions(c *model.AIClassifyChange, suggestionsJSON, newCategory string, isNew bool) error {
	return database.DB.Model(c).Updates(map[string]interface{}{
		"suggestions":  suggestionsJSON,
		"new_category": newCategory,
		"is_new":       isNew,
		"status":       "pending",
		"batch_run":    "",
	}).Error
}

func BulkUpdateAIChangeStatus(ids []uint, status string) (int64, error) {
	result := database.DB.Model(&model.AIClassifyChange{}).
		Where("id IN ? AND status = ?", ids, "pending").
		Update("status", status)
	return result.RowsAffected, result.Error
}

// GetAllPendingAIChanges returns every pending change, optionally restricted to
// a single batch run. Used by the "approve all by confidence" flow.
func GetAllPendingAIChanges(batchRun string) ([]model.AIClassifyChange, error) {
	var list []model.AIClassifyChange
	q := database.DB.Model(&model.AIClassifyChange{}).Where("status = ?", "pending")
	if batchRun != "" {
		q = q.Where("batch_run = ?", batchRun)
	}
	err := q.Order("created_at DESC").Find(&list).Error
	return list, err
}

// HasPendingAIChange returns true if a pending change already exists for the quote in this batch.
func HasPendingAIChange(quoteID uint, batchRun string) bool {
	var count int64
	q := database.DB.Model(&model.AIClassifyChange{}).
		Where("quote_id = ? AND status = 'pending'", quoteID)
	if batchRun != "" {
		q = q.Where("batch_run = ?", batchRun)
	}
	q.Count(&count)
	return count > 0
}

func CountAIChangesByStatus(batchRun string) map[string]int64 {
	type result struct {
		Status string
		Count  int64
	}
	var rows []result
	q := database.DB.Model(&model.AIClassifyChange{}).
		Select("status, COUNT(*) as count").
		Group("status")
	if batchRun != "" {
		q = q.Where("batch_run = ?", batchRun)
	}
	q.Scan(&rows)

	counts := map[string]int64{"pending": 0, "approved": 0, "rejected": 0, "skipped": 0}
	for _, r := range rows {
		counts[r.Status] = r.Count
	}
	return counts
}

// ─── AIReviewChange ───────────────────────────────────────────────────────────

func CreateAIReviewChange(c *model.AIReviewChange) error {
	return database.DB.Create(c).Error
}

func FindAIReviewChangeByID(id uint) (*model.AIReviewChange, error) {
	var c model.AIReviewChange
	if err := database.DB.First(&c, id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

type AIReviewChangeFilter struct {
	Status   string
	BatchRun string
	Page     int
	PageSize int
}

func ListAIReviewChanges(f AIReviewChangeFilter) ([]model.AIReviewChange, int64, error) {
	q := database.DB.Model(&model.AIReviewChange{})
	if f.Status != "" {
		q = q.Where("status = ?", f.Status)
	}
	if f.BatchRun != "" {
		q = q.Where("batch_run = ?", f.BatchRun)
	}

	var total int64
	q.Count(&total)

	if f.Page < 1 {
		f.Page = 1
	}
	if f.PageSize < 1 || f.PageSize > 200 {
		f.PageSize = 50
	}

	var list []model.AIReviewChange
	err := q.Order("created_at DESC").
		Offset((f.Page - 1) * f.PageSize).
		Limit(f.PageSize).
		Find(&list).Error
	return list, total, err
}

func UpdateAIReviewChangeStatus(c *model.AIReviewChange, status string) error {
	return database.DB.Model(c).Update("status", status).Error
}

func BulkUpdateAIReviewChangeStatus(ids []uint, status string) (int64, error) {
	result := database.DB.Model(&model.AIReviewChange{}).
		Where("id IN ? AND status = ?", ids, "pending").
		Update("status", status)
	return result.RowsAffected, result.Error
}

// GetAllPendingAIReviewChanges returns every pending review change, optionally
// restricted to a single batch run. Used by the "apply all by confidence" flow.
func GetAllPendingAIReviewChanges(batchRun string) ([]model.AIReviewChange, error) {
	var list []model.AIReviewChange
	q := database.DB.Model(&model.AIReviewChange{}).Where("status = ?", "pending")
	if batchRun != "" {
		q = q.Where("batch_run = ?", batchRun)
	}
	err := q.Order("created_at DESC").Find(&list).Error
	return list, err
}

// HasPendingAIReviewChange returns true if a pending review change already exists
// for the quote in this batch.
func HasPendingAIReviewChange(quoteID uint, batchRun string) bool {
	var count int64
	q := database.DB.Model(&model.AIReviewChange{}).
		Where("quote_id = ? AND status = 'pending'", quoteID)
	if batchRun != "" {
		q = q.Where("batch_run = ?", batchRun)
	}
	q.Count(&count)
	return count > 0
}

func CountAIReviewChangesByStatus(batchRun string) map[string]int64 {
	type result struct {
		Status string
		Count  int64
	}
	var rows []result
	q := database.DB.Model(&model.AIReviewChange{}).
		Select("status, COUNT(*) as count").
		Group("status")
	if batchRun != "" {
		q = q.Where("batch_run = ?", batchRun)
	}
	q.Scan(&rows)

	counts := map[string]int64{"pending": 0, "approved": 0, "rejected": 0, "skipped": 0}
	for _, r := range rows {
		counts[r.Status] = r.Count
	}
	return counts
}
