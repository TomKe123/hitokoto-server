package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"

	"hitokoto-server/internal/model"
	"hitokoto-server/pkg/database"

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

	var codes []gin.H
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

	var result []gin.H
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
