package handler

import (
	"errors"
	"math/rand"
	"net/http"
	"strconv"
	"strings"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/repository"
	"hitokoto-server/backend/utils"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ListHandler struct{}

type CreateListInput struct {
	Name        string `json:"name" binding:"required"`
	Description string `json:"description"`
	IsPublic    bool   `json:"is_public"`
	Type        string `json:"type"`
}

type UpdateListInput struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	IsPublic    *bool   `json:"is_public"`
}

type AddItemsInput struct {
	QuoteIDs []uint `json:"quote_ids" binding:"required"`
}

type ReorderItemsInput struct {
	ItemIDs []uint `json:"item_ids" binding:"required"`
}

// --- Owner check helper ---

func (h *ListHandler) getOwnedList(c *gin.Context) (*model.QuoteList, bool) {
	userID := c.GetUint("user_id")
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list ID"})
		return nil, false
	}

	list, err := repository.GetListByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get list"})
		}
		return nil, false
	}

	if list.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return nil, false
	}

	return list, true
}

// 5.2 CreateList
func (h *ListHandler) CreateList(c *gin.Context) {
	userID := c.GetUint("user_id")

	var input CreateListInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name is required"})
		return
	}

	if input.Name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name cannot be empty"})
		return
	}

	list := model.QuoteList{
		Name:        input.Name,
		Description: input.Description,
		IsPublic:    input.IsPublic,
		UserID:      userID,
	}

	// Validate and set type
	if input.Type != "" {
		if input.Type != "normal" && input.Type != "aggregated" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "type must be 'normal' or 'aggregated'"})
			return
		}
		list.Type = input.Type
	} else {
		list.Type = "normal"
	}

	// Generate API key for private lists
	var rawAPIKey string
	if !input.IsPublic {
		key, err := utils.GenerateAPIKey()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate API key"})
			return
		}
		rawAPIKey = key
		list.APIKeyHash = utils.HashAPIKey(key)
	}

	if err := repository.CreateList(&list); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create list"})
		return
	}

	resp := toListResponse(list)
	if rawAPIKey != "" {
		resp["api_key"] = rawAPIKey
	}

	c.JSON(http.StatusCreated, resp)
}

// 5.3 GetOwnLists
func (h *ListHandler) GetOwnLists(c *gin.Context) {
	userID := c.GetUint("user_id")
	lists, err := repository.GetListsByUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch lists"})
		return
	}

	resp := make([]gin.H, 0, len(lists))
	for _, list := range lists {
		resp = append(resp, toListResponse(list))
	}

	c.JSON(http.StatusOK, gin.H{"lists": resp})
}

// 5.4 GetList
func (h *ListHandler) GetList(c *gin.Context) {
	userID := c.GetUint("user_id")
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list ID"})
		return
	}

	list, err := repository.GetListByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get list"})
		}
		return
	}

	if list.UserID != userID {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return
	}

	// Parse pagination
	page := 1
	pageSize := 50
	if p, err := strconv.Atoi(c.Query("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.Query("page_size")); err == nil && ps > 0 {
		pageSize = ps
		if pageSize > 200 {
			pageSize = 200
		}
	}

	var itemResponses []gin.H
	var total int64

	if list.Type == "aggregated" {
		// Aggregated list: recursively collect quotes from referenced lists
		itemResponses, total, err = h.getAggregatedQuotes(list.ID, page, pageSize)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch aggregated quotes"})
			return
		}
		totalPages := (int(total) + pageSize - 1) / pageSize
		if totalPages < 1 {
			totalPages = 1
		}
		c.JSON(http.StatusOK, gin.H{
			"list":         toListResponse(*list),
			"items":        itemResponses,
			"total":        total,
			"page":         page,
			"page_size":    pageSize,
			"total_pages":  totalPages,
			"list_tree":    h.getReferenceTree(list.ID),
		})
		return
	} else {
		items, itemTotal, err := repository.GetListItemsPaginated(list.ID, page, pageSize)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch items"})
			return
		}
		total = itemTotal

		itemResponses = make([]gin.H, 0, len(items))
		for _, item := range items {
			itemResp := gin.H{
				"id":         item.ID,
				"quote_id":   item.QuoteID,
				"sort_order": item.SortOrder,
			}
			if q, err := loadQuoteByID(item.QuoteID); err == nil {
				itemResp["quote_content"] = q.Content
				itemResp["quote_uuid"] = q.UUID
			}
			itemResponses = append(itemResponses, itemResp)
		}
	}

	totalPages := (int(total) + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"list":         toListResponse(*list),
		"items":        itemResponses,
		"total":        total,
		"page":         page,
		"page_size":    pageSize,
		"total_pages":  totalPages,
	})
}

// 5.5 UpdateList
func (h *ListHandler) UpdateList(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	var input UpdateListInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	updates := map[string]interface{}{}

	if input.Name != nil {
		if *input.Name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "name cannot be empty"})
			return
		}
		updates["name"] = *input.Name
	}
	if input.Description != nil {
		updates["description"] = *input.Description
	}

	var rawAPIKey string
	if input.IsPublic != nil {
		updates["is_public"] = *input.IsPublic
		if *input.IsPublic {
			// Switching to public — clear API key
			updates["api_key_hash"] = nil
		} else if list.IsPublic {
			// Switching to private — generate API key
			key, err := utils.GenerateAPIKey()
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate API key"})
				return
			}
			rawAPIKey = key
			updates["api_key_hash"] = utils.HashAPIKey(key)
		}
	}

	if len(updates) == 0 {
		c.JSON(http.StatusOK, toListResponse(*list))
		return
	}

	if err := repository.UpdateList(list.ID, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update list"})
		return
	}

	// Reload the list
	updated, err := repository.GetListByID(list.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload list"})
		return
	}

	resp := toListResponse(*updated)
	if rawAPIKey != "" {
		resp["api_key"] = rawAPIKey
	}

	c.JSON(http.StatusOK, resp)
}

// 5.6 DeleteList
func (h *ListHandler) DeleteList(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	// 5.4 Prevent deletion of lists that are referenced by aggregated lists
	hasRefs, err := repository.HasReferencesByTargetListID(list.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check references"})
		return
	}
	if hasRefs {
		c.JSON(http.StatusBadRequest, gin.H{"error": "list is referenced by aggregated lists"})
		return
	}

	if err := repository.DeleteList(list.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete list"})
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// 5.7 AddItems
func (h *ListHandler) AddItems(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	var input AddItemsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quote_ids is required"})
		return
	}

	if len(input.QuoteIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "quote_ids cannot be empty"})
		return
	}

	result, err := repository.AddItemsToList(list.ID, input.QuoteIDs)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to add items"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"added":      result.Added,
		"duplicates": result.Duplicates,
		"not_found":  result.NotFound,
	})
}

// 5.8 RemoveItem
func (h *ListHandler) RemoveItem(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	itemIDStr := c.Param("itemId")
	itemID, err := strconv.ParseUint(itemIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid item ID"})
		return
	}

	if err := repository.RemoveItemFromList(list.ID, uint(itemID)); err != nil {
		if err.Error() == "item not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "item not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to remove item"})
		}
		return
	}

	c.JSON(http.StatusNoContent, nil)
}

// 5.9 ReorderItems
func (h *ListHandler) ReorderItems(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	var input ReorderItemsInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "item_ids is required"})
		return
	}

	if len(input.ItemIDs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "item_ids cannot be empty"})
		return
	}

	// Validate that the item count matches
	var total int64
	items, total, err := repository.GetListItemsPaginated(list.ID, 1, 1)
	_ = items
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate items"})
		return
	}
	if int(total) != len(input.ItemIDs) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "item_ids count does not match list item count",
		})
		return
	}

	if err := repository.ReorderItems(list.ID, input.ItemIDs); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reorder items"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "items reordered"})
}

// --- List Reference Endpoints ---

// 2.2 GetReferences lists all references of an aggregated list.
func (h *ListHandler) GetReferences(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	refs, err := repository.GetReferencesByListID(list.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch references"})
		return
	}

	refResponses := make([]gin.H, 0, len(refs))
	for _, ref := range refs {
		// Load target list info
		targetList, err := repository.GetListByID(ref.TargetListID)
		targetName := ""
		targetUUID := ""
		targetUserID := uint(0)
		targetIsPublic := false
		if err == nil {
			targetName = targetList.Name
			targetUUID = targetList.UUID
			targetUserID = targetList.UserID
			targetIsPublic = targetList.IsPublic
		}
		refResponses = append(refResponses, gin.H{
			"id":              ref.ID,
			"target_list_id":  ref.TargetListID,
			"target_name":     targetName,
			"target_uuid":     targetUUID,
			"target_user_id":  targetUserID,
			"target_is_public": targetIsPublic,
			"created_at":      ref.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"references": refResponses})
}

// 2.3 AddReference adds a reference from an aggregated list to another list.
func (h *ListHandler) AddReference(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	// 5.1 Validate that source list is aggregated type
	if list.Type != "aggregated" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "can only add references to aggregated lists"})
		return
	}

	var input struct {
		TargetListID   uint   `json:"target_list_id"`
		TargetListUUID string `json:"target_list_uuid"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	// Resolve target list by UUID or ID
	var targetList *model.QuoteList
	var err error
	if input.TargetListUUID != "" {
		targetList, err = repository.GetListByUUID(input.TargetListUUID)
	} else if input.TargetListID != 0 {
		targetList, err = repository.GetListByID(input.TargetListID)
	} else {
		c.JSON(http.StatusBadRequest, gin.H{"error": "target_list_id or target_list_uuid is required"})
		return
	}
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "target list not found"})
		return
	}

	// 5.3 Validate access: user must own source list; target list must be
	// either owned by user OR be a public list (allow cross-user references)
	userID := c.GetUint("user_id")
	if targetList.UserID != userID && !targetList.IsPublic {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied: target list is private"})
		return
	}

	// 5.5 Circular references are allowed — the system handles them by
	// deduplicating quotes during recursive expansion with cycle detection.

	// Create the reference
	ref, err := repository.CreateReference(list.ID, targetList.ID)
	if err != nil {
		if isDuplicateKeyError(err) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "reference already exists"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create reference"})
		return
	}

	// Update reference count on target list
	repository.UpdateReferenceCount(targetList.ID)

	c.JSON(http.StatusCreated, gin.H{
		"id":             ref.ID,
		"source_list_id": ref.SourceListID,
		"target_list_id": ref.TargetListID,
		"created_at":     ref.CreatedAt,
	})
}

// 2.4 RemoveReference removes a reference from an aggregated list.
func (h *ListHandler) RemoveReference(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	refIDStr := c.Param("refId")
	refID, err := strconv.ParseUint(refIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid reference ID"})
		return
	}

	// Verify the reference belongs to this list by checking via repository
	refs, err := repository.GetReferencesByListID(list.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify reference"})
		return
	}
	var targetListID uint
	found := false
	for _, ref := range refs {
		if ref.ID == uint(refID) {
			targetListID = ref.TargetListID
			found = true
			break
		}
	}
	if !found {
		c.JSON(http.StatusNotFound, gin.H{"error": "reference not found"})
		return
	}

	if err := repository.DeleteReference(uint(refID)); err != nil {
		if err.Error() == "reference not found" {
			c.JSON(http.StatusNotFound, gin.H{"error": "reference not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete reference"})
		}
		return
	}

	// Update reference count on the target list
	repository.UpdateReferenceCount(targetListID)

	c.JSON(http.StatusNoContent, nil)
}

// --- End of List Reference Endpoints ---

// 5.10 RegenerateKey
func (h *ListHandler) RegenerateKey(c *gin.Context) {
	list, ok := h.getOwnedList(c)
	if !ok {
		return
	}

	if list.IsPublic {
		c.JSON(http.StatusBadRequest, gin.H{"error": "public lists do not have API keys"})
		return
	}

	key, err := utils.GenerateAPIKey()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate API key"})
		return
	}

	if err := repository.UpdateAPIKeyHash(list.ID, utils.HashAPIKey(key)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update API key"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"api_key": key})
}

// GetPublicListByUUID returns a single public list by UUID.
func (h *ListHandler) ListPublicLists(c *gin.Context) {
	page := 1
	pageSize := 50
	if p, err := strconv.Atoi(c.Query("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.Query("page_size")); err == nil && ps > 0 {
		pageSize = ps
		if pageSize > 200 {
			pageSize = 200
		}
	}

	lists, total, err := repository.GetPublicListsPaginated(page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch public lists"})
		return
	}

	totalPages := (int(total) + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}

	listResponses := make([]gin.H, 0, len(lists))
	for _, l := range lists {
		owner := ""
		if u, err := repository.FindUserByID(l.UserID); err == nil {
			owner = u.Username
		}
		listResponses = append(listResponses, gin.H{
			"id":          l.ID,
			"uuid":        l.UUID,
			"name":        l.Name,
			"description": l.Description,
			"is_public":   l.IsPublic,
			"item_count":  l.ItemCount,
			"type":        l.Type,
			"owner":       owner,
			"created_at":  l.CreatedAt,
			"updated_at":  l.UpdatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"lists":       listResponses,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	})
}

// 5.11 GetPublicList
func (h *ListHandler) GetPublicList(c *gin.Context) {
	// The ListKeyMiddleware already validates public/private access.
	// It injects list_id into the context on success.
	listID, exists := c.Get("list_id")
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return
	}

	list, err := repository.GetListByID(listID.(uint))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return
	}

	// Attach owner info
	user, err := repository.FindUserByID(list.UserID)
	username := ""
	if err == nil {
		username = user.Username
	}

	page := 1
	pageSize := 50
	if p, err := strconv.Atoi(c.Query("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.Query("page_size")); err == nil && ps > 0 {
		pageSize = ps
		if pageSize > 200 {
			pageSize = 200
		}
	}

	var itemResponses []gin.H
	var total int64

	if list.Type == "aggregated" {
		itemResponses, total, err = h.getAggregatedQuotes(list.ID, page, pageSize)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch aggregated quotes"})
			return
		}
	} else {
		items, itemTotal, err := repository.GetListItemsPaginated(list.ID, page, pageSize)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch items"})
			return
		}
		total = itemTotal

		itemResponses = make([]gin.H, 0, len(items))
		for _, item := range items {
			itemResp := gin.H{
				"id":         item.ID,
				"quote_id":   item.QuoteID,
				"sort_order": item.SortOrder,
			}
			if q, err := loadQuoteByID(item.QuoteID); err == nil {
				itemResp["quote_content"] = q.Content
				itemResp["quote_uuid"] = q.UUID
				itemResp["quote_from"] = q.From
				itemResp["quote_category"] = q.Category
			}
			itemResponses = append(itemResponses, itemResp)
		}
	}

	totalPages := (int(total) + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}

	resp := gin.H{
		"list": gin.H{
			"uuid":        list.UUID,
			"name":        list.Name,
			"description": list.Description,
			"is_public":   list.IsPublic,
			"item_count":  list.ItemCount,
			"type":        list.Type,
			"reference_count": list.ReferenceCount,
			"owner":       username,
			"created_at":  list.CreatedAt,
			"updated_at":  list.UpdatedAt,
		},
		"items":       itemResponses,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	}
	if list.Type == "aggregated" {
		resp["list_tree"] = h.getReferenceTree(list.ID)
	}
	c.JSON(http.StatusOK, resp)
}

// GetRandomFromList returns a random quote from a public/private list identified by ?list=UUID.
// For private lists, the ?key= parameter (API key) is required.
// Supports ?token= for deduplication (same as /api/quotes/random).
func (h *ListHandler) GetRandomFromList(c *gin.Context) {
	listUUID := c.Query("list")
	if listUUID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "list parameter is required"})
		return
	}

	// Look up list by UUID
	list, err := repository.GetListByUUID(listUUID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to find list"})
		}
		return
	}

	// Access control: public lists allow any request; private lists require ?key=
	if !list.IsPublic {
		apiKey := c.Query("key")
		if apiKey == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "API key required for private list"})
			return
		}
		if list.APIKeyHash == "" || list.APIKeyHash != utils.HashAPIKey(apiKey) {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid API key"})
			return
		}
	}

	// Get all quote IDs in the list
	var quoteIDs []uint
	if list.Type == "aggregated" {
		leafIDs, err := repository.GetReferencedListIDsRecursive(list.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch aggregated list data"})
			return
		}
		for _, leafID := range leafIDs {
			ids, err := repository.GetListQuoteIDs(leafID)
			if err != nil {
				continue
			}
			quoteIDs = append(quoteIDs, ids...)
		}
	} else {
		quoteIDs, err = repository.GetListQuoteIDs(list.ID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch list items"})
			return
		}
	}
	if len(quoteIDs) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no quotes in list"})
		return
	}

	// Load only approved quotes for these IDs
	var quotes []model.Quote
	if err := repository.ApprovedQuotesQuery().Where("id IN ?", quoteIDs).Find(&quotes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load quotes"})
		return
	}
	if len(quotes) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no approved quotes in list"})
		return
	}

	// Token-based dedup (same mechanism as /api/quotes/random)
	var anonToken string
	if token, exists := c.Get("anonymous_token"); exists {
		if t, ok := token.(string); ok && t != "" {
			anonToken = t
			seenUUIDs, err := middleware.GetSeenQuotes(anonToken)
			if err == nil && len(seenUUIDs) > 0 {
				seenMap := make(map[string]bool, len(seenUUIDs))
				for _, uuid := range seenUUIDs {
					seenMap[uuid] = true
				}
				filtered := make([]model.Quote, 0, len(quotes))
				for _, q := range quotes {
					if !seenMap[q.UUID] {
						filtered = append(filtered, q)
					}
				}
				quotes = filtered
			}
		}
	}

	if len(quotes) == 0 {
		// All quotes in this list have been seen by this token.
		// Reset the token's seen records and re-pick from the full list.
		if anonToken != "" {
			repository.DeleteSeenQuotesByToken(anonToken)
			// Re-load the full approved quote list
			var freshQuotes []model.Quote
			if err := repository.ApprovedQuotesQuery().Where("id IN ?", quoteIDs).Find(&freshQuotes).Error; err == nil {
				quotes = freshQuotes
			}
		}
	}

	if len(quotes) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "no approved quotes in list"})
		return
	}

	// Pick a random quote
	quote := quotes[rand.Intn(len(quotes))]

	resp := gin.H{"quote": toQuoteResponse(quote)}
	if anonToken != "" {
		middleware.RecordSeenQuote(anonToken, quote.UUID)
		resp["token"] = anonToken
	}

	c.JSON(http.StatusOK, resp)
}

// --- Response helpers ---

// --- Aggregated List Helpers ---

// getReferenceTree builds a hierarchical tree of referenced lists for display.
func (h *ListHandler) getReferenceTree(listID uint) []gin.H {
	visited := make(map[uint]bool)
	return h.buildTreeNodes(listID, visited)
}

func (h *ListHandler) buildTreeNodes(listID uint, visited map[uint]bool) []gin.H {
	if visited[listID] {
		return nil
	}
	visited[listID] = true

	refs, err := repository.GetReferencesByListID(listID)
	if err != nil || len(refs) == 0 {
		return nil
	}

	var nodes []gin.H
	for _, ref := range refs {
		if visited[ref.TargetListID] {
			continue
		}

		targetList, err := repository.GetListByID(ref.TargetListID)
		if err != nil {
			continue
		}
		node := gin.H{
			"list_id":   targetList.ID,
			"list_uuid": targetList.UUID,
			"list_name": targetList.Name,
			"type":      targetList.Type,
		}
		// If target is also aggregated, recurse
		if targetList.Type == "aggregated" {
			children := h.buildTreeNodes(targetList.ID, visited)
			if len(children) > 0 {
				node["children"] = children
			}
		}
		visited[ref.TargetListID] = true
		nodes = append(nodes, node)
	}
	return nodes
}

// getAggregatedQuotes recursively collects quotes from referenced lists,
// with pagination and sorting by created_at.
func (h *ListHandler) getAggregatedQuotes(listID uint, page, pageSize int) ([]gin.H, int64, error) {
	// Collect all referenced list IDs recursively (max depth 5)
	allRefIDs, err := repository.GetReferencedListIDsRecursive(listID)
	if err != nil {
		return nil, 0, err
	}

	// Always include the aggregated list itself (it may have own items)
	allIDs := append([]uint{listID}, allRefIDs...)

	if len(allIDs) == 0 {
		return []gin.H{}, 0, nil
	}

	// Count distinct approved quotes across all source lists
	var total int64
	database.DB.Model(&model.QuoteListItem{}).
		Select("COUNT(DISTINCT quotes.id)").
		Joins("JOIN quotes ON quotes.id = quote_list_items.quote_id").
		Where("quote_list_items.list_id IN ? AND quotes.status = ?", allIDs, "approved").
		Count(&total)

	if total == 0 {
		return []gin.H{}, 0, nil
	}

	// Fetch paginated quotes, grouped by quote_id to deduplicate
	type AggregatedItem struct {
		QuoteID          uint   `gorm:"column:quote_id"`
		ID               uint   `gorm:"column:id"`
		ListID           uint   `gorm:"column:list_id"`
		SortOrder        int    `gorm:"column:sort_order"`
		CreatedAt        string `gorm:"column:created_at"`
		Content          string `gorm:"column:quote_content"`
		QuoteUUID        string `gorm:"column:quote_uuid"`
		SourceListName   string `gorm:"column:source_list_name"`
		SourceListUUID   string `gorm:"column:source_list_uuid"`
		SourceListUserID uint   `gorm:"column:source_list_user_id"`
	}

	var items []AggregatedItem
	offset := (page - 1) * pageSize
	err = database.DB.Table("quote_list_items").
		Select(`quotes.id AS quote_id,
		        MIN(quote_list_items.id) AS id,
		        MIN(quote_list_items.list_id) AS list_id,
		        MIN(quote_list_items.sort_order) AS sort_order,
		        MAX(quote_list_items.created_at) AS created_at,
		        MIN(quotes.content) AS quote_content,
		        MIN(quotes.uuid) AS quote_uuid,
		        MIN(quote_lists.name) AS source_list_name,
		        MIN(quote_lists.uuid) AS source_list_uuid,
		        MIN(quote_lists.user_id) AS source_list_user_id`).
		Joins("JOIN quotes ON quotes.id = quote_list_items.quote_id").
		Joins("JOIN quote_lists ON quote_lists.id = quote_list_items.list_id").
		Where("quote_list_items.list_id IN ? AND quotes.status = ?", allIDs, "approved").
		Group("quotes.id").
		Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Scan(&items).Error
	if err != nil {
		return nil, 0, err
	}

	// 消除重复直到没有重复 — 双层保证：SQL GROUP BY + 代码级 map 过滤
	itemResponses := make([]gin.H, 0, len(items))
	seenQuoteIDs := make(map[uint]bool)
	for _, item := range items {
		if seenQuoteIDs[item.QuoteID] {
			continue
		}
		seenQuoteIDs[item.QuoteID] = true
		itemResp := gin.H{
			"id":                 item.ID,
			"quote_id":           item.QuoteID,
			"sort_order":         item.SortOrder,
			"source_list_id":     item.ListID,
			"source_list_name":   item.SourceListName,
			"source_list_uuid":   item.SourceListUUID,
			"source_list_user_id": item.SourceListUserID,
			"quote_content":      item.Content,
			"quote_uuid":         item.QuoteUUID,
		}
		itemResponses = append(itemResponses, itemResp)
	}

	return itemResponses, total, nil
}

// --- End of Aggregated List Helpers ---

// isDuplicateKeyError checks if the error is a database duplicate key violation.
func isDuplicateKeyError(err error) bool {
	return err != nil && (strings.Contains(err.Error(), "UNIQUE constraint failed") ||
		strings.Contains(err.Error(), "Duplicate entry"))
}

// loadQuoteByID loads a single approved quote by its ID.
func loadQuoteByID(id uint) (*model.Quote, error) {
	var q model.Quote
	err := repository.ApprovedQuotesQuery().Where("id = ?", id).First(&q).Error
	if err != nil {
		return nil, err
	}
	return &q, nil
}

func toListResponse(list model.QuoteList) gin.H {
	return gin.H{
		"id":              list.ID,
		"uuid":            list.UUID,
		"name":            list.Name,
		"description":     list.Description,
		"is_public":       list.IsPublic,
		"user_id":         list.UserID,
		"item_count":      list.ItemCount,
		"type":            list.Type,
		"reference_count": list.ReferenceCount,
		"created_at":      list.CreatedAt,
		"updated_at":      list.UpdatedAt,
	}
}
