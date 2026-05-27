package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"

	"hitokoto-server/backend/middleware"
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
		Count    int `json:"count" binding:"required,min=1,max=100"`
		MaxUses  int `json:"max_uses"`
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
	for i := 0; i < input.Count; i++ {
		code := model.InviteCode{
			Code:      generateCode(8),
			MaxUses:   input.MaxUses,
			CreatedBy: userID,
		}
		if err := database.DB.Create(&code).Error; err != nil {
			continue
		}
		codes = append(codes, gin.H{
			"id":       code.ID,
			"code":     code.Code,
			"max_uses": code.MaxUses,
		})
	}

	c.JSON(http.StatusCreated, gin.H{"codes": codes})
}

func (h *AdminHandler) ListInviteCodes(c *gin.Context) {
	var codes []model.InviteCode
	database.DB.Order("created_at DESC").Find(&codes)

	result := make([]gin.H, 0)
	for _, c := range codes {
		result = append(result, gin.H{
			"id":        c.ID,
			"code":      c.Code,
			"max_uses":  c.MaxUses,
			"use_count": c.UseCount,
			"created_by": c.CreatedBy,
			"created_at": c.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"codes": result})
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

	userRole := c.GetString("role")
	userID := c.GetUint("user_id")

	if target.ID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot ban yourself"})
		return
	}

	targetRank := middleware.RoleRank[target.Role]
	actorRank := middleware.RoleRank[userRole]

	if actorRank <= targetRank {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot ban user with equal or higher role"})
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

// SetUserRole changes a user's role between "user" and "collaborator" (admin only).
func (h *AdminHandler) SetUserRole(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	userID := c.GetUint("user_id")
	if uint(targetID) == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change your own role"})
		return
	}

	var input struct {
		Role string `json:"role" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Role != "user" && input.Role != "collaborator" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role, must be 'user' or 'collaborator'"})
		return
	}

	var target model.User
	if err := database.DB.First(&target, targetID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if target.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot change admin role"})
		return
	}

	database.DB.Model(&target).Update("role", input.Role)
	c.JSON(http.StatusOK, gin.H{"message": "user role updated successfully"})
}
