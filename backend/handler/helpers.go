package handler

import (
	"fmt"
	"strconv"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"github.com/gin-gonic/gin"
)

func toQuoteResponse(q model.Quote) gin.H {
	return gin.H{
		"uuid":           q.UUID,
		"content":        q.Content,
		"from":           q.From,
		"category":       q.Category,
		"source":         q.Source,
		"contributor_id": q.ContributorID,
		"status":         q.Status,
		"created_at":     q.CreatedAt,
		"updated_at":     q.UpdatedAt,
	}
}

func parseInt(s string, defaultVal int) (int, error) {
	if s == "" {
		return defaultVal, nil
	}
	var val int
	_, err := fmt.Sscanf(s, "%d", &val)
	if err != nil {
		return defaultVal, err
	}
	return val, nil
}

func parseUint(s string) uint {
	v, _ := strconv.ParseUint(s, 10, 64)
	return uint(v)
}

func createNotification(userID int64, quoteUUID, notifType, title, content string) {
	if userID < 0 {
		return
	}
	database.DB.Create(&model.Notification{
		UserID:    uint(userID),
		QuoteUUID: quoteUUID,
		Type:      notifType,
		Title:     title,
		Content:   content,
	})
}

func truncateText(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "…"
}
