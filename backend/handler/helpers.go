package handler

import (
	"fmt"

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
