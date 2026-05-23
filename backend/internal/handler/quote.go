package handler

import (
	"net/http"

	"hitokoto-server/internal/model"
	"hitokoto-server/pkg/database"

	"github.com/gin-gonic/gin"
)

type QuoteHandler struct{}

type CreateQuoteInput struct {
	Content  string `json:"content" binding:"required"`
	From     string `json:"from"`
	Category string `json:"category" binding:"required"`
	Source   string `json:"source"`
}

type UpdateQuoteInput struct {
	Content  string `json:"content"`
	From     string `json:"from"`
	Category string `json:"category"`
	Source   string `json:"source"`
}

func (h *QuoteHandler) Create(c *gin.Context) {
	userID := c.GetUint("user_id")

	var input CreateQuoteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	quote := model.Quote{
		Content:       input.Content,
		From:          input.From,
		Category:      input.Category,
		Source:        input.Source,
		ContributorID: userID,
	}

	if err := database.DB.Create(&quote).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create quote"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) CreateWithInviteCode(c *gin.Context) {
	var input struct {
		CreateQuoteInput
		InviteCode string `json:"invite_code" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Validate invite code
	var code model.InviteCode
	if result := database.DB.Where("code = ?", input.InviteCode).First(&code); result.Error != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid invite code"})
		return
	}
	if code.UseCount >= code.MaxUses {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invite code has been exhausted"})
		return
	}

	// Use admin as contributor if available, otherwise user ID 0
	contributorID := uint(0)
	var admin model.User
	if err := database.DB.Where("role = ?", "admin").First(&admin).Error; err == nil {
		contributorID = admin.ID
	}

	quote := model.Quote{
		Content:       input.Content,
		From:          input.From,
		Category:      input.Category,
		Source:        input.Source,
		ContributorID: contributorID,
	}

	if err := database.DB.Create(&quote).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create quote"})
		return
	}

	// Increment invite code usage
	database.DB.Model(&code).Update("use_count", code.UseCount+1)

	c.JSON(http.StatusCreated, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) GetByID(c *gin.Context) {
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) List(c *gin.Context) {
	page := 1
	pageSize := 20
	category := c.Query("category")
	keyword := c.Query("keyword")

	if p, err := parseInt(c.Query("page"), 1); err == nil {
		page = p
	}
	if ps, err := parseInt(c.Query("page_size"), 20); err == nil {
		pageSize = ps
	}

	query := database.DB.Model(&model.Quote{})
	if category != "" {
		query = query.Where("category = ?", category)
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		query = query.Where("content ILIKE ? OR \"from\" ILIKE ?", like, like)
	}

	var total int64
	query.Count(&total)

	var quotes []model.Quote
	offset := (page - 1) * pageSize
	query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&quotes)

	var responses []gin.H
	for _, q := range quotes {
		responses = append(responses, toQuoteResponse(q))
	}

	c.JSON(http.StatusOK, gin.H{
		"quotes":     responses,
		"total":      total,
		"page":       page,
		"page_size":  pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

func (h *QuoteHandler) Update(c *gin.Context) {
	userID := c.GetUint("user_id")
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.ContributorID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	var input UpdateQuoteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if input.Content != "" {
		updates["content"] = input.Content
	}
	if input.From != "" {
		updates["from"] = input.From
	}
	if input.Category != "" {
		updates["category"] = input.Category
	}
	if input.Source != "" {
		updates["source"] = input.Source
	}

	database.DB.Model(&quote).Updates(updates)
	database.DB.First(&quote, quote.ID)

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) Delete(c *gin.Context) {
	userID := c.GetUint("user_id")
	id := c.Param("id")

	var quote model.Quote
	if err := database.DB.Where("uuid = ?", id).Or("id = ?", id).First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}

	if quote.ContributorID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	database.DB.Delete(&quote)
	c.JSON(http.StatusOK, gin.H{"message": "quote deleted successfully"})
}

func (h *QuoteHandler) Random(c *gin.Context) {
	category := c.Query("category")

	var quote model.Quote
	query := database.DB.Model(&model.Quote{})
	if category != "" {
		query = query.Where("category = ?", category)
	}

	if err := query.Order("RANDOM()").First(&quote).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no quotes found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"quote": toQuoteResponse(quote)})
}

func (h *QuoteHandler) ListCategories(c *gin.Context) {
	var categories []model.Category
	database.DB.Find(&categories)

	if len(categories) == 0 {
		// Fallback: extract unique categories from quotes
		var results []struct {
			Category string
			Count    int64
		}
		database.DB.Model(&model.Quote{}).
			Select("category, COUNT(*) as count").
			Group("category").
			Find(&results)

		var list []gin.H
		for _, r := range results {
			list = append(list, gin.H{"name": r.Category, "quote_count": r.Count})
		}
		c.JSON(http.StatusOK, gin.H{"categories": list})
		return
	}

	var list []gin.H
	for _, cat := range categories {
		var count int64
		database.DB.Model(&model.Quote{}).Where("category = ?", cat.Name).Count(&count)
		list = append(list, gin.H{
			"id":          cat.ID,
			"name":        cat.Name,
			"quote_count": count,
		})
	}
	c.JSON(http.StatusOK, gin.H{"categories": list})
}

