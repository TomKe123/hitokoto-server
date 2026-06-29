package handler

import (
	"fmt"
	"strconv"
	"strings"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// toQuoteResponse serializes a single quote, loading its full category set.
// Use toQuoteResponseWithCats in list contexts to avoid N+1 queries.
func toQuoteResponse(q model.Quote) gin.H {
	cats := repository.GetCategoriesForQuote(q.ID)
	if len(cats) == 0 && q.Category != "" {
		cats = []string{q.Category}
	}
	return quoteResponseWith(q, cats)
}

// toQuoteResponseWithCats serializes a quote using a pre-loaded category set.
func toQuoteResponseWithCats(q model.Quote, cats []string) gin.H {
	if len(cats) == 0 && q.Category != "" {
		cats = []string{q.Category}
	}
	return quoteResponseWith(q, cats)
}

func quoteResponseWith(q model.Quote, cats []string) gin.H {
	return gin.H{
		"id":             q.ID,
		"uuid":           q.UUID,
		"content":        q.Content,
		"from":           q.From,
		"category":       q.Category, // primary category (backward compatible)
		"categories":     cats,       // full category set
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
	repository.CreateNotification(&model.Notification{
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

// applySearchFilter adds LIKE clauses for each search term (AND logic).
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

// applySearchGroupFilter handles grouped search terms.
// Each group's terms are combined with OR, groups are combined with AND.
// Example: search_group=命运%20选择&search_group=勇气
//   → (命运 OR 选择) AND 勇气
func applySearchGroupFilter(query *gorm.DB, searchGroups []string) *gorm.DB {
	likeClauses := make([]string, 0)
	likeArgs := make([]interface{}, 0)

	for _, g := range searchGroups {
		g = strings.TrimSpace(g)
		if g == "" {
			continue
		}
		terms := strings.Fields(g)
		groupClauses := make([]string, 0)
		var groupArgs []interface{}
		for _, t := range terms {
			t = strings.NewReplacer("%", "", "_", "").Replace(t)
			like := "%" + t + "%"
			groupClauses = append(groupClauses, "(content LIKE ? OR `from` LIKE ? OR source LIKE ?)")
			groupArgs = append(groupArgs, like, like, like)
		}
		if len(groupClauses) > 0 {
			likeClauses = append(likeClauses, "("+strings.Join(groupClauses, " OR ")+")")
			likeArgs = append(likeArgs, groupArgs...)
		}
	}

	if len(likeClauses) > 0 {
		query = query.Where(strings.Join(likeClauses, " AND "), likeArgs...)
	}
	return query
}
