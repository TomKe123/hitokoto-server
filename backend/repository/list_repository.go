package repository

import (
	"errors"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/utils"

	"gorm.io/gorm"
)

// --- List CRUD ---

func CreateList(list *model.QuoteList) error {
	return database.DB.Create(list).Error
}

func GetListByID(id uint) (*model.QuoteList, error) {
	var list model.QuoteList
	err := database.DB.First(&list, id).Error
	if err != nil {
		return nil, err
	}
	return &list, nil
}

func GetListsByUserID(userID uint) ([]model.QuoteList, error) {
	var lists []model.QuoteList
	err := database.DB.Where("user_id = ?", userID).Order("updated_at DESC").Find(&lists).Error
	return lists, err
}

func UpdateList(id uint, updates map[string]interface{}) error {
	return database.DB.Model(&model.QuoteList{}).Where("id = ?", id).Updates(updates).Error
}

func DeleteList(id uint) error {
	// Collect target list IDs before deleting references
	var targetIDs []uint
	database.DB.Model(&model.QuoteListReference{}).
		Where("source_list_id = ?", id).
		Pluck("target_list_id", &targetIDs)

	if err := database.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("list_id = ?", id).Delete(&model.QuoteListItem{}).Error; err != nil {
			return err
		}
		if err := tx.Where("source_list_id = ?", id).Delete(&model.QuoteListReference{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&model.QuoteList{}, id).Error; err != nil {
			return err
		}
		return nil
	}); err != nil {
		return err
	}

	// Bulk-update reference counts in one query instead of N separate queries
	if len(targetIDs) > 0 {
		return database.DB.Exec(`
			UPDATE quote_lists
			SET reference_count = (
				SELECT COUNT(*) FROM quote_list_references
				WHERE quote_list_references.target_list_id = quote_lists.id
			)
			WHERE id IN ?`, targetIDs).Error
	}
	return nil
}

func GetListByUUID(uuid string) (*model.QuoteList, error) {
	var list model.QuoteList
	err := database.DB.Where("uuid = ?", uuid).First(&list).Error
	if err != nil {
		return nil, err
	}
	return &list, nil
}

// GetPublicListsPaginated returns paginated public lists with owner info.
// When includeBlocked is true, blocked lists are also returned (admin use).
func GetPublicListsPaginated(page, pageSize int, includeBlocked ...bool) ([]model.QuoteList, int64, error) {
	var lists []model.QuoteList
	var total int64

	query := database.DB.Model(&model.QuoteList{}).Where("is_public = ?", true)
	if len(includeBlocked) == 0 || !includeBlocked[0] {
		query = query.Where("blocked = ?", false)
	}
	query.Count(&total)

	offset := (page - 1) * pageSize
	query = database.DB.Where("is_public = ?", true)
	if len(includeBlocked) == 0 || !includeBlocked[0] {
		query = query.Where("blocked = ?", false)
	}
	err := query.
		Order("updated_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&lists).Error

	return lists, total, err
}

// GetAllListsPaginated returns all lists with owner username, paginated (admin use).
type AdminListRow struct {
	model.QuoteList
	Username string `json:"username"`
}

func GetAllListsPaginated(page, pageSize int) ([]AdminListRow, int64, error) {
	var rows []AdminListRow
	var total int64

	database.DB.Model(&model.QuoteList{}).Count(&total)

	offset := (page - 1) * pageSize
	err := database.DB.Table("quote_lists").
		Select("quote_lists.*, users.username").
		Joins("LEFT JOIN users ON users.id = quote_lists.user_id").
		Order("quote_lists.updated_at DESC").
		Offset(offset).Limit(pageSize).
		Scan(&rows).Error

	return rows, total, err
}

// DeleteListAsAdmin deletes any list by ID (admin override — no ownership check).
func DeleteListAsAdmin(id uint) error {
	return DeleteList(id)
}

// SearchPublicListsByName searches public, non-blocked lists by name (LIKE query).
func SearchPublicListsByName(q string, page, pageSize int) ([]model.QuoteList, int64, error) {
	var lists []model.QuoteList
	var total int64

	query := database.DB.Model(&model.QuoteList{}).
		Where("is_public = ? AND blocked = ? AND name LIKE ?", true, false, "%"+q+"%")
	query.Count(&total)

	offset := (page - 1) * pageSize
	err := query.Order("updated_at DESC").Offset(offset).Limit(pageSize).Find(&lists).Error
	return lists, total, err
}

// BlockList marks a list as blocked with an optional reason.
func BlockList(id uint, reason string) error {
	return database.DB.Model(&model.QuoteList{}).Where("id = ?", id).
		Updates(map[string]interface{}{"blocked": true, "blocked_reason": reason}).Error
}

// UnblockList removes the blocked status from a list.
func UnblockList(id uint) error {
	return database.DB.Model(&model.QuoteList{}).Where("id = ?", id).
		Updates(map[string]interface{}{"blocked": false, "blocked_reason": ""}).Error
}

// IsListBlocked checks whether a list is blocked.
func IsListBlocked(id uint) (bool, error) {
	var list model.QuoteList
	err := database.DB.Select("blocked").First(&list, id).Error
	if err != nil {
		return false, err
	}
	return list.Blocked, nil
}

// ListBlockedScope returns a GORM scope to exclude blocked lists.
func ListBlockedScope(db *gorm.DB) *gorm.DB {
	return db.Where("blocked = ?", false)
}

// --- List Items ---

type AddItemsResult struct {
	Added      int `json:"added"`
	Duplicates int `json:"duplicates"`
	NotFound   int `json:"not_found"`
}

func AddItemsToList(listID uint, quoteIDs []uint) (*AddItemsResult, error) {
	result := &AddItemsResult{}

	// Verify quotes exist and are approved
	var count int64
	database.DB.Model(&model.Quote{}).Where("id IN ? AND status = ?", quoteIDs, "approved").Count(&count)
	result.NotFound = len(quoteIDs) - int(count)

	// Get existing items to detect duplicates
	var existingQuoteIDs []uint
	database.DB.Model(&model.QuoteListItem{}).
		Where("list_id = ? AND quote_id IN ?", listID, quoteIDs).
		Pluck("quote_id", &existingQuoteIDs)

	dupSet := make(map[uint]bool)
	for _, qid := range existingQuoteIDs {
		dupSet[qid] = true
	}

	// Find max sort order
	var maxSort int
	database.DB.Model(&model.QuoteListItem{}).
		Where("list_id = ?", listID).
		Select("COALESCE(MAX(sort_order), 0)").
		Scan(&maxSort)

	nextSort := maxSort + 1
	itemsToCreate := make([]model.QuoteListItem, 0)

	for _, qid := range quoteIDs {
		if dupSet[qid] {
			result.Duplicates++
			continue
		}
		// Check if quote exists and is approved
		var q model.Quote
		if err := database.DB.Where("id = ? AND status = ?", qid, "approved").First(&q).Error; err != nil {
			result.NotFound++
			continue
		}

		itemsToCreate = append(itemsToCreate, model.QuoteListItem{
			ListID:    listID,
			QuoteID:   qid,
			SortOrder: nextSort,
		})
		nextSort++
		result.Added++
	}

	if len(itemsToCreate) > 0 {
		if err := database.DB.Create(&itemsToCreate).Error; err != nil {
			return nil, err
		}
	}

	// Update item count
	database.DB.Model(&model.QuoteList{}).Where("id = ?", listID).
		Update("item_count", gorm.Expr("item_count + ?", result.Added))

	return result, nil
}

func RemoveItemFromList(listID, itemID uint) error {
	result := database.DB.Where("id = ? AND list_id = ?", itemID, listID).Delete(&model.QuoteListItem{})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("item not found")
	}
	// Decrement item count
	database.DB.Model(&model.QuoteList{}).Where("id = ?", listID).
		Update("item_count", gorm.Expr("GREATEST(item_count - 1, 0)"))
	return nil
}

func ReorderItems(listID uint, itemIDs []uint) error {
	return database.DB.Transaction(func(tx *gorm.DB) error {
		for i, itemID := range itemIDs {
			if err := tx.Model(&model.QuoteListItem{}).
				Where("id = ? AND list_id = ?", itemID, listID).
				Update("sort_order", i+1).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func GetListItemsPaginated(listID uint, page, pageSize int) ([]model.QuoteListItem, int64, error) {
	var items []model.QuoteListItem
	var total int64

	database.DB.Model(&model.QuoteListItem{}).Where("list_id = ?", listID).Count(&total)

	offset := (page - 1) * pageSize
	err := database.DB.Where("list_id = ?", listID).
		Order("sort_order ASC").
		Offset(offset).Limit(pageSize).
		Find(&items).Error

	return items, total, err
}

// GetListQuoteIDs returns all quote IDs in the list (ordered by sort_order).
func GetListQuoteIDs(listID uint) ([]uint, error) {
	var ids []uint
	err := database.DB.Model(&model.QuoteListItem{}).
		Where("list_id = ?", listID).
		Order("sort_order ASC").
		Pluck("quote_id", &ids).Error
	return ids, err
}

// --- List References ---

func GetReferencesByListID(listID uint) ([]model.QuoteListReference, error) {
	var refs []model.QuoteListReference
	err := database.DB.Where("source_list_id = ?", listID).Find(&refs).Error
	return refs, err
}

func CreateReference(sourceListID, targetListID uint) (*model.QuoteListReference, error) {
	ref := model.QuoteListReference{
		SourceListID: sourceListID,
		TargetListID: targetListID,
	}
	err := database.DB.Create(&ref).Error
	if err != nil {
		return nil, err
	}
	return &ref, nil
}

func DeleteReference(id uint) error {
	result := database.DB.Delete(&model.QuoteListReference{}, id)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return errors.New("reference not found")
	}
	return nil
}

// GetReferencedListIDsRecursive performs a recursive DFS to find all referenced list IDs
// from an aggregated list. The visited map converges naturally — each list is visited
// at most once, so traversal terminates when no new lists remain.
func GetReferencedListIDsRecursive(listID uint) ([]uint, error) {
	visited := make(map[uint]bool)
	var result []uint

	var dfs func(currentID uint) error
	dfs = func(currentID uint) error {
		if visited[currentID] {
			return nil
		}
		visited[currentID] = true

		var refs []model.QuoteListReference
		if err := database.DB.Where("source_list_id = ?", currentID).Find(&refs).Error; err != nil {
			return err
		}
		for _, ref := range refs {
			if visited[ref.TargetListID] {
				continue
			}
			result = append(result, ref.TargetListID)
			if err := dfs(ref.TargetListID); err != nil {
				return err
			}
		}
		return nil
	}

	if err := dfs(listID); err != nil {
		return nil, err
	}
	return result, nil
}

func UpdateReferenceCount(listID uint) error {
	var count int64
	database.DB.Model(&model.QuoteListReference{}).Where("target_list_id = ?", listID).Count(&count)
	return database.DB.Model(&model.QuoteList{}).Where("id = ?", listID).
		Update("reference_count", count).Error
}

// HasReference checks if adding a reference from sourceListID to targetListID
// would create a circular dependency (DFS traversal).
func HasReference(sourceListID, targetListID uint) (bool, error) {
	// Check direct reference first
	var count int64
	database.DB.Model(&model.QuoteListReference{}).
		Where("source_list_id = ? AND target_list_id = ?", sourceListID, targetListID).
		Count(&count)
	if count > 0 {
		return true, nil
	}

	// DFS: check if targetListID eventually references sourceListID
	visited := make(map[uint]bool)
	var dfs func(currentID uint) (bool, error)
	dfs = func(currentID uint) (bool, error) {
		if visited[currentID] {
			return false, nil
		}
		visited[currentID] = true

		var refs []model.QuoteListReference
		if err := database.DB.Where("source_list_id = ?", currentID).Find(&refs).Error; err != nil {
			return false, err
		}
		for _, ref := range refs {
			if ref.TargetListID == sourceListID {
				return true, nil
			}
			exists, err := dfs(ref.TargetListID)
			if err != nil {
				return false, err
			}
			if exists {
				return true, nil
			}
		}
		return false, nil
	}

	return dfs(targetListID)
}

// HasReferencesByTargetListID checks if any aggregated lists reference the given list.
func HasReferencesByTargetListID(listID uint) (bool, error) {
	var count int64
	err := database.DB.Model(&model.QuoteListReference{}).
		Where("target_list_id = ?", listID).
		Count(&count).Error
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// --- API Key Methods ---

func GetListByUUIDWithKey(uuid, keyHash string) (*model.QuoteList, error) {
	var list model.QuoteList
	err := database.DB.Where("uuid = ? AND api_key_hash = ?", uuid, keyHash).First(&list).Error
	if err != nil {
		return nil, err
	}
	return &list, nil
}

func UpdateAPIKeyHash(listID uint, keyHash string) error {
	return database.DB.Model(&model.QuoteList{}).Where("id = ?", listID).
		Update("api_key_hash", keyHash).Error
}

func ClearAPIKeyHash(listID uint) error {
	return database.DB.Model(&model.QuoteList{}).Where("id = ?", listID).
		Update("api_key_hash", gorm.Expr("NULL")).Error
}

// ValidateListAPIKey checks if the given API key matches the list's stored hash.
func ValidateListAPIKey(listID uint, rawKey string) (bool, error) {
	var list model.QuoteList
	err := database.DB.Select("api_key_hash").First(&list, listID).Error
	if err != nil {
		return false, err
	}
	if list.APIKeyHash == "" {
		return false, nil
	}
	return list.APIKeyHash == utils.HashAPIKey(rawKey), nil
}
