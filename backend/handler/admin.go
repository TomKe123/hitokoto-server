package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"time"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/database"

	"github.com/gin-gonic/gin"
)

type AdminHandler struct{}

func generateCode(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *AdminHandler) CreateInviteCodes(c *gin.Context) {
	var input struct {
		Count      int    `json:"count" binding:"required,min=1,max=100"`
		MaxUses    int    `json:"max_uses"`
		CustomCode string `json:"custom_code"`
		ExpireDays int    `json:"expire_days"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.MaxUses < 1 {
		input.MaxUses = 1
	}

	userID := c.GetUint("user_id")

	codes := make([]gin.H, 0)
	count := input.Count
	customCodes := []string{}

	if input.CustomCode != "" {
		count = 1
		customCodes = append(customCodes, input.CustomCode)
	}

	for i := 0; i < count; i++ {
		codeStr := ""
		if i < len(customCodes) {
			codeStr = customCodes[i]
		} else {
			codeStr = generateCode(8)
		}

		var expiresAt *time.Time
		if input.ExpireDays > 0 {
			t := time.Now().Add(time.Duration(input.ExpireDays) * 24 * time.Hour)
			expiresAt = &t
		}

		code := model.InviteCode{
			Code:      codeStr,
			MaxUses:   input.MaxUses,
			CreatedBy: userID,
			ExpiresAt: expiresAt,
		}
		if err := database.DB.Create(&code).Error; err != nil {
			continue
		}
		resp := gin.H{
			"id":       code.ID,
			"code":     code.Code,
			"max_uses": code.MaxUses,
		}
		if code.ExpiresAt != nil {
			resp["expires_at"] = code.ExpiresAt
		}
		codes = append(codes, resp)
	}

	c.JSON(http.StatusCreated, gin.H{"codes": codes})
}

func (h *AdminHandler) ListInviteCodes(c *gin.Context) {
	var codes []model.InviteCode
	database.DB.Order("created_at DESC").Find(&codes)

	result := make([]gin.H, 0)
	for _, ic := range codes {
		item := gin.H{
			"id":         ic.ID,
			"code":       ic.Code,
			"max_uses":   ic.MaxUses,
			"use_count":  ic.UseCount,
			"created_by": ic.CreatedBy,
			"created_at": ic.CreatedAt,
		}
		if ic.ExpiresAt != nil {
			item["expires_at"] = ic.ExpiresAt
		}
		result = append(result, item)
	}

	c.JSON(http.StatusOK, gin.H{"codes": result})
}

func (h *AdminHandler) DeleteInviteCode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	result := database.DB.Delete(&model.InviteCode{}, id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "invite code not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *AdminHandler) UpdateInviteCode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var input struct {
		MaxUses    int `json:"max_uses"`
		ExpireDays int `json:"expire_days"`
		ResetUse   bool `json:"reset_use"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var code model.InviteCode
	if err := database.DB.First(&code, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invite code not found"})
		return
	}

	updates := map[string]interface{}{}
	if input.MaxUses > 0 {
		updates["max_uses"] = input.MaxUses
	}
	if input.ExpireDays > 0 {
		t := time.Now().Add(time.Duration(input.ExpireDays) * 24 * time.Hour)
		updates["expires_at"] = &t
	} else if input.ExpireDays == -1 {
		updates["expires_at"] = nil
	}
	if input.ResetUse {
		updates["use_count"] = 0
	}

	if len(updates) > 0 {
		database.DB.Model(&code).Updates(updates)
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

type hitokotoEntry struct {
	ID        int    `json:"id"`
	UUID      string `json:"uuid"`
	Hitokoto  string `json:"hitokoto"`
	Type      string `json:"type"`
	From      string `json:"from"`
	FromWho   string `json:"from_who"`
	Creator   string `json:"creator"`
	CreatorID int    `json:"creator_id"`
	CreatedAt string `json:"created_at"`
}

func (h *AdminHandler) ImportJSON(c *gin.Context) {
	userID := c.GetUint("user_id")

	var entries []hitokotoEntry
	if err := c.ShouldBindJSON(&entries); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON format, expected array"})
		return
	}

	if len(entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty array"})
		return
	}

	var (
		imported int
		skipped  int
	)

	for _, entry := range entries {
		content := entry.Hitokoto
		if content == "" {
			skipped++
			continue
		}

		from := entry.From
		if entry.FromWho != "" {
			if from != "" {
				from = from + " - " + entry.FromWho
			} else {
				from = entry.FromWho
			}
		}

		category := entry.Type
		if category == "" {
			category = "other"
		}

		// Map hitokoto types to our categories
		categoryMap := map[string]string{
			"a": "anime",
			"b": "comic",
			"c": "game",
			"d": "novel",
			"e": "movie",
			"f": "music",
			"g": "other",
			"h": "other",
			"i": "other",
			"j": "other",
			"k": "other",
			"l": "other",
		}
		if mapped, ok := categoryMap[category]; ok {
			category = mapped
		}

		// Check duplicate by UUID
		if entry.UUID != "" {
			var count int64
			database.DB.Model(&model.Quote{}).Where("uuid = ?", entry.UUID).Count(&count)
			if count > 0 {
				skipped++
				continue
			}
		}

		quote := model.Quote{
			UUID:          entry.UUID,
			Content:       content,
			From:          from,
			Category:      category,
			ContributorID: userID,
		}
		if quote.UUID == "" {
			quote.UUID = generateCode(16)
		}

		if err := database.DB.Create(&quote).Error; err != nil {
			skipped++
			continue
		}
		imported++
	}

	c.JSON(http.StatusOK, gin.H{
		"imported": imported,
		"skipped":  skipped,
		"total":    len(entries),
	})
}

// ListUsers returns paginated user list with role and status filters (admin only).
func (h *AdminHandler) ListUsers(c *gin.Context) {
	page := 1
	pageSize := 20
	role := c.Query("role")
	status := c.Query("status")

	if p, err := strconv.Atoi(c.Query("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.Query("page_size")); err == nil && ps > 0 && ps <= 100 {
		pageSize = ps
	}

	query := database.DB.Model(&model.User{})
	if role != "" {
		query = query.Where("role = ?", role)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64
	query.Count(&total)

	var users []model.User
	offset := (page - 1) * pageSize
	query.Order("id ASC").Offset(offset).Limit(pageSize).Find(&users)

	results := make([]gin.H, 0)
	for _, u := range users {
		results = append(results, gin.H{
			"id":         u.ID,
			"username":   u.Username,
			"email":      u.Email,
			"role":       u.Role,
			"permissions": u.Permissions,
			"status":     u.Status,
			"created_at": u.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"users":       results,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// BanUser bans a user. Admin can ban anyone; collaborator can only ban regular users.
func (h *AdminHandler) BanUser(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var target model.User
	if err := database.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	userID := c.GetUint("user_id")

	if target.ID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot ban yourself"})
		return
	}

	if target.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot ban admin user"})
		return
	}

	if target.Status == "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user is already banned"})
		return
	}

	database.DB.Model(&target).Update("status", "banned")
	c.JSON(http.StatusOK, gin.H{"message": "user banned successfully"})
}

// UnbanUser unbans a user (admin only).
func (h *AdminHandler) UnbanUser(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	var target model.User
	if err := database.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if target.Status != "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user is not banned"})
		return
	}

	database.DB.Model(&target).Update("status", "active")
	c.JSON(http.StatusOK, gin.H{"message": "user unbanned successfully"})
}

// SetUserPermissions sets a user's permission bits (admin only).
func (h *AdminHandler) SetUserPermissions(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	userID := c.GetUint("user_id")
	if uint(targetID) == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change your own permissions"})
		return
	}

	var input struct {
		Permissions uint64 `json:"permissions" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var target model.User
	if err := database.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if target.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot change admin permissions"})
		return
	}

	database.DB.Model(&target).Update("permissions", input.Permissions)
	c.JSON(http.StatusOK, gin.H{"message": "user permissions updated successfully"})
}

func (h *AdminHandler) BatchQuotes(c *gin.Context) {
	var input struct {
		Action string   `json:"action" binding:"required"`
		UUIDs  []string `json:"uuids" binding:"required,min=1,max=1000"`
		Reason string   `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Action != "approve" && input.Action != "reject" && input.Action != "delete" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid action, must be 'approve', 'reject', or 'delete'"})
		return
	}

	var affected int64
	if input.Action == "delete" {
		result := database.DB.Where("uuid IN ?", input.UUIDs).Delete(&model.Quote{})
		affected = result.RowsAffected
	} else {
		status := input.Action + "d" // approve -> approved, reject -> rejected
		result := database.DB.Model(&model.Quote{}).Where("uuid IN ?", input.UUIDs).Update("status", status)
		affected = result.RowsAffected

		// Create notifications for reject actions
		if input.Action == "reject" {
			var quotes []model.Quote
			database.DB.Where("uuid IN ?", input.UUIDs).Find(&quotes)
			for _, q := range quotes {
				notifContent := "您的语录「" + truncateText(q.Content, 50) + "」未通过审核。"
				if input.Reason != "" {
					notifContent += "原因：" + input.Reason
				}
				createNotification(q.ContributorID, q.UUID, "rejected",
					"语录未通过审核", notifContent)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "batch operation completed",
		"affected": affected,
		"total":    len(input.UUIDs),
	})
}

func (h *AdminHandler) ApproveAllRejected(c *gin.Context) {
	result := database.DB.Model(&model.Quote{}).Where("status = ?", "rejected").Update("status", "approved")
	c.JSON(http.StatusOK, gin.H{
		"message":  "all rejected quotes approved",
		"affected": result.RowsAffected,
	})
}

func (h *AdminHandler) GetQuoteStats(c *gin.Context) {
	var all, pending, approved, rejected int64
	database.DB.Model(&model.Quote{}).Count(&all)
	database.DB.Model(&model.Quote{}).Where("status = ?", "pending").Count(&pending)
	database.DB.Model(&model.Quote{}).Where("status = ?", "approved").Count(&approved)
	database.DB.Model(&model.Quote{}).Where("status = ?", "rejected").Count(&rejected)
	c.JSON(http.StatusOK, gin.H{
		"all":      all,
		"pending":  pending,
		"approved": approved,
		"rejected": rejected,
	})
}

func (h *AdminHandler) GetSettings(c *gin.Context) {
	var settings []model.Setting
	database.DB.Find(&settings)

	result := make(map[string]string)
	for _, s := range settings {
		result[s.Key] = s.Value
	}
	c.JSON(http.StatusOK, gin.H{"settings": result})
}

func (h *AdminHandler) UpdateSetting(c *gin.Context) {
	var input struct {
		Key   string `json:"key" binding:"required"`
		Value string `json:"value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var setting model.Setting
	database.DB.Where("key = ?", input.Key).FirstOrCreate(&setting)
	setting.Value = input.Value
	database.DB.Save(&setting)
	c.JSON(http.StatusOK, gin.H{"setting": setting})
}

func (h *AdminHandler) CreateCategory(c *gin.Context) {
	var input struct {
		Name        string `json:"name" binding:"required,min=1,max=50"`
		DisplayName string `json:"display_name" binding:"max=50"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	category := model.Category{Name: input.Name, DisplayName: input.DisplayName}
	if err := database.DB.Create(&category).Error; err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "category already exists"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"category": gin.H{"id": category.ID, "name": category.Name, "display_name": category.DisplayName}})
}

func (h *AdminHandler) UpdateCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var input struct {
		Name        string `json:"name" binding:"required,min=1,max=50"`
		DisplayName string `json:"display_name" binding:"max=50"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var category model.Category
	if err := database.DB.First(&category, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}

	updates := map[string]interface{}{"name": input.Name}
	if input.DisplayName != "" {
		updates["display_name"] = input.DisplayName
	}
	database.DB.Model(&category).Updates(updates)
	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *AdminHandler) DeleteCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var category model.Category
	if err := database.DB.First(&category, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}

	// Set quotes with this category to "other"
	database.DB.Model(&model.Quote{}).Where("category = ?", category.Name).Update("category", "other")

	database.DB.Delete(&category)
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
