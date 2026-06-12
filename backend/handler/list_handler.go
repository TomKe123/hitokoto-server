package handler

import (
	"errors"
	"math/rand"
	"net/http"
	"strconv"

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

	items, total, err := repository.GetListItemsPaginated(list.ID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch items"})
		return
	}

	itemResponses := make([]gin.H, 0, len(items))
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

	items, total, err := repository.GetListItemsPaginated(list.ID, page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch items"})
		return
	}

	itemResponses := make([]gin.H, 0, len(items))
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

	totalPages := (int(total) + pageSize - 1) / pageSize
	if totalPages < 1 {
		totalPages = 1
	}

	c.JSON(http.StatusOK, gin.H{
		"list": gin.H{
			"uuid":        list.UUID,
			"name":        list.Name,
			"description": list.Description,
			"is_public":   list.IsPublic,
			"item_count":  list.ItemCount,
			"owner":       username,
			"created_at":  list.CreatedAt,
			"updated_at":  list.UpdatedAt,
		},
		"items":       itemResponses,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": totalPages,
	})
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
	quoteIDs, err := repository.GetListQuoteIDs(list.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch list items"})
		return
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
		"id":          list.ID,
		"uuid":        list.UUID,
		"name":        list.Name,
		"description": list.Description,
		"is_public":   list.IsPublic,
		"user_id":     list.UserID,
		"item_count":  list.ItemCount,
		"created_at":  list.CreatedAt,
		"updated_at":  list.UpdatedAt,
	}
}
