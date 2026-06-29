package repository

import (
	"strconv"
	"strings"

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

// FindQuoteByID looks up a single quote by its primary key.
func FindQuoteByID(id uint) (*model.Quote, error) {
	var q model.Quote
	if err := database.DB.First(&q, id).Error; err != nil {
		return nil, err
	}
	return &q, nil
}

func ReloadQuote(q *model.Quote) error {
	return database.DB.First(q, q.ID).Error
}

func DeleteQuote(q *model.Quote) error {
	database.DB.Where("quote_id = ?", q.ID).Delete(&model.QuoteCategory{})
	return database.DB.Delete(q).Error
}

func DeleteQuotesByUUIDs(uuids []string) (int64, error) {
	// Resolve IDs first so we can clean up the junction table.
	var ids []uint
	database.DB.Model(&model.Quote{}).Where("uuid IN ?", uuids).Pluck("id", &ids)
	if len(ids) > 0 {
		database.DB.Where("quote_id IN ?", ids).Delete(&model.QuoteCategory{})
	}
	result := database.DB.Where("uuid IN ?", uuids).Delete(&model.Quote{})
	return result.RowsAffected, result.Error
}

func BatchUpdateQuoteStatus(uuids []string, status string) (int64, error) {
	result := database.DB.Model(&model.Quote{}).Where("uuid IN ?", uuids).Update("status", status)
	return result.RowsAffected, result.Error
}

// UpdateQuoteStatus updates the status of a single quote by its ID.
func UpdateQuoteStatus(quoteID uint, status string) error {
	return database.DB.Model(&model.Quote{}).Where("id = ?", quoteID).Update("status", status).Error
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

// CountApprovedByCategory counts approved quotes that have the given category
// anywhere in their category set (via the junction table).
func CountApprovedByCategory(category string) (int64, error) {
	var count int64
	err := database.DB.Model(&model.Quote{}).
		Where("status = ?", "approved").
		Where("id IN (?)", database.DB.Model(&model.QuoteCategory{}).
			Select("quote_id").Where("category = ?", category)).
		Count(&count).Error
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

// ReassignCategoryQuotes handles deletion of a category. It removes the category
// from every quote's junction set; quotes whose set becomes empty get
// fallbackCategory instead, and any quote whose primary Quote.Category was the
// deleted one is repointed to a remaining category (or fallback).
func ReassignCategoryQuotes(oldCategory, fallbackCategory string) {
	database.DB.Transaction(func(tx *gorm.DB) error {
		// Quotes that currently have the category in their junction set.
		var quoteIDs []uint
		tx.Model(&model.QuoteCategory{}).
			Where("category = ?", oldCategory).
			Pluck("quote_id", &quoteIDs)

		// Remove the category from the junction table everywhere.
		tx.Where("category = ?", oldCategory).Delete(&model.QuoteCategory{})

		for _, qid := range quoteIDs {
			var remaining []string
			tx.Model(&model.QuoteCategory{}).
				Where("quote_id = ?", qid).
				Order("id ASC").
				Pluck("category", &remaining)

			if len(remaining) == 0 {
				// Set became empty — fall back.
				tx.Create(&model.QuoteCategory{QuoteID: qid, Category: fallbackCategory})
				remaining = []string{fallbackCategory}
			}

			// Keep Quote.Category (primary) valid: if it pointed at the deleted
			// category, repoint to the first remaining one.
			tx.Model(&model.Quote{}).
				Where("id = ? AND category = ?", qid, oldCategory).
				Update("category", remaining[0])
		}
		return nil
	})
}

// --- QuoteCategory (junction) operations ---

// SetQuoteCategories replaces a quote's full category set in a transaction and
// keeps Quote.Category (primary) in sync with the first element. Empty input is
// ignored (no-op) to preserve the not-null invariant.
func SetQuoteCategories(quoteID uint, categories []string) error {
	cats := normalizeCategories(categories)
	if len(cats) == 0 {
		return nil
	}
	return database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("quote_id = ?", quoteID).Delete(&model.QuoteCategory{}).Error; err != nil {
			return err
		}
		for _, c := range cats {
			if err := tx.Create(&model.QuoteCategory{QuoteID: quoteID, Category: c}).Error; err != nil {
				return err
			}
		}
		return tx.Model(&model.Quote{}).Where("id = ?", quoteID).Update("category", cats[0]).Error
	})
}

// AddQuoteCategory appends a category to a quote's set (deduplicated). It does
// not change the primary Quote.Category. Used by the AI-approve flow.
func AddQuoteCategory(quoteID uint, category string) error {
	category = strings.ToLower(strings.TrimSpace(category))
	if category == "" {
		return nil
	}
	var count int64
	database.DB.Model(&model.QuoteCategory{}).
		Where("quote_id = ? AND category = ?", quoteID, category).
		Count(&count)
	if count > 0 {
		return nil
	}
	return database.DB.Create(&model.QuoteCategory{QuoteID: quoteID, Category: category}).Error
}

// GetCategoriesForQuote returns the full category set for a single quote,
// ordered by insertion. Falls back to the quote's primary category if the
// junction table is somehow empty.
func GetCategoriesForQuote(quoteID uint) []string {
	var cats []string
	database.DB.Model(&model.QuoteCategory{}).
		Where("quote_id = ?", quoteID).
		Order("id ASC").
		Pluck("category", &cats)
	return cats
}

// GetCategoriesForQuotes batch-loads category sets for many quotes in one query,
// keyed by quote ID and ordered by insertion within each quote.
func GetCategoriesForQuotes(quoteIDs []uint) map[uint][]string {
	result := make(map[uint][]string)
	if len(quoteIDs) == 0 {
		return result
	}
	var rows []model.QuoteCategory
	database.DB.Where("quote_id IN ?", quoteIDs).
		Order("quote_id ASC, id ASC").
		Find(&rows)
	for _, r := range rows {
		result[r.QuoteID] = append(result[r.QuoteID], r.Category)
	}
	return result
}

// FilterByCategories restricts a quote query to quotes that have ANY of the
// given categories in their set (OR semantics), using a subquery so result
// rows are not duplicated.
func FilterByCategories(query *gorm.DB, categories []string) *gorm.DB {
	cats := normalizeCategories(categories)
	if len(cats) == 0 {
		return query
	}
	sub := database.DB.Model(&model.QuoteCategory{}).
		Select("quote_id").Where("category IN ?", cats)
	return query.Where("id IN (?)", sub)
}

// normalizeCategories trims, lowercases, drops empties and de-duplicates while
// preserving order.
func normalizeCategories(categories []string) []string {
	seen := make(map[string]bool)
	out := make([]string, 0, len(categories))
	for _, c := range categories {
		c = strings.ToLower(strings.TrimSpace(c))
		if c == "" || seen[c] {
			continue
		}
		seen[c] = true
		out = append(out, c)
	}
	return out
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
	// Auto-set ID based on current max ID
	var maxID uint
	if err := database.DB.Model(&model.Category{}).Select("COALESCE(MAX(id), 0)").Scan(&maxID).Error; err != nil {
		return err
	}
	cat.ID = maxID + 1
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

func FindCategoryByName(name string) (*model.Category, error) {
	var cat model.Category
	err := database.DB.Where("name = ?", name).First(&cat).Error
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

// CountAllQuotes returns the total number of quotes.
func CountAllQuotes() (int64, error) {
	var count int64
	err := database.DB.Model(&model.Quote{}).Count(&count).Error
	return count, err
}

// GetQuotesBatch returns a page of quotes ordered by ID, for batch processing.
func GetQuotesBatch(offset, limit int) ([]model.Quote, error) {
	var quotes []model.Quote
	err := database.DB.Order("id ASC").Offset(offset).Limit(limit).Find(&quotes).Error
	return quotes, err
}

// QuoteBatchFilter restricts which quotes a batch AI classification run covers.
// All fields are optional; an empty filter matches every quote.
type QuoteBatchFilter struct {
	Status           string   // pending / approved / rejected (empty = any)
	Categories       []string // match quotes having ANY of these categories
	Search           []string // free-text terms; each must match content/from/source
	OnlyUnclassified bool     // only quotes with no AIClassifyChange record yet
	OnlyUnreviewed   bool     // only quotes with no AIReviewChange record yet
}

// batchFilterQuery builds the *gorm.DB selecting quotes matching the filter.
func batchFilterQuery(f QuoteBatchFilter) *gorm.DB {
	query := database.DB.Model(&model.Quote{})
	if f.Status != "" {
		query = query.Where("status = ?", f.Status)
	}
	if len(f.Categories) > 0 {
		query = FilterByCategories(query, f.Categories)
	}
	for _, s := range f.Search {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		// Strip SQL wildcards so LIKE is safe without ESCAPE.
		s = strings.NewReplacer("%", "", "_", "").Replace(s)
		like := "%" + s + "%"
		query = query.Where("(content LIKE ? OR `from` LIKE ? OR source LIKE ?)", like, like, like)
	}
	if f.OnlyUnclassified {
		// Exclude quotes that already have any AIClassifyChange record.
		sub := database.DB.Model(&model.AIClassifyChange{}).Select("quote_id")
		query = query.Where("id NOT IN (?)", sub)
	}
	if f.OnlyUnreviewed {
		// Exclude quotes that already have any AIReviewChange record.
		sub := database.DB.Model(&model.AIReviewChange{}).Select("quote_id")
		query = query.Where("id NOT IN (?)", sub)
	}
	return query
}

// CountQuotesFiltered counts quotes matching the batch filter.
func CountQuotesFiltered(f QuoteBatchFilter) (int64, error) {
	var count int64
	err := batchFilterQuery(f).Count(&count).Error
	return count, err
}

// GetQuotesBatchFilteredAfter returns up to limit filtered quotes with ID
// greater than afterID, ordered by ID ascending. Keyset pagination keeps the
// run correct even when processed quotes drop out of the filter mid-run (e.g.
// the OnlyUnclassified filter, where each quote gains a change record).
func GetQuotesBatchFilteredAfter(f QuoteBatchFilter, afterID uint, limit int) ([]model.Quote, error) {
	var quotes []model.Quote
	err := batchFilterQuery(f).
		Where("id > ?", afterID).
		Order("id ASC").
		Limit(limit).
		Find(&quotes).Error
	return quotes, err
}
