package handler

import (
	"fmt"
	"strconv"
	"strings"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
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

// applySearchFilter adds LIKE clauses for each search term across content/from/source.
// Strips SQL wildcards from search terms to avoid database-specific ESCAPE syntax.
func applySearchFilter(query *gorm.DB, searchArr []string) *gorm.DB {
	for _, s := range searchArr {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		// Remove SQL wildcard characters so LIKE is safe without ESCAPE
		s = strings.NewReplacer("%", "", "_", "").Replace(s)
		like := "%" + s + "%"
		query = query.Where("(content LIKE ? OR `from` LIKE ? OR source LIKE ?)", like, like, like)
	}
	return query
}
