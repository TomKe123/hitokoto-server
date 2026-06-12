package middleware

import (
	"net/http"
	"strings"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/utils"

	"github.com/gin-gonic/gin"
)

// ListKeyMiddleware parses Authorization: Bearer <key> and validates it against
// the list identified by the :uuid route parameter. It injects list_id and
// list_uuid into the context on success.
//
// For public lists, no key is required — the middleware passes through.
// For private lists, a valid API key is required (401 if missing, 403 if invalid).
func ListKeyMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		uuid := c.Param("uuid")
		if uuid == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "list UUID is required"})
			c.Abort()
			return
		}

		// Look up list by UUID
		var list model.QuoteList
		if err := database.DB.Where("uuid = ?", uuid).First(&list).Error; err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
			c.Abort()
			return
		}

		if list.IsPublic {
			// Public list — no key needed
			c.Set("list_id", list.ID)
			c.Set("list_uuid", list.UUID)
			c.Next()
			return
		}

		// Private list — require API key
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "API key required for private list"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header format"})
			c.Abort()
			return
		}

		rawKey := parts[1]
		keyHash := utils.HashAPIKey(rawKey)

		if list.APIKeyHash == "" || list.APIKeyHash != keyHash {
			c.JSON(http.StatusForbidden, gin.H{"error": "invalid API key"})
			c.Abort()
			return
		}

		c.Set("list_id", list.ID)
		c.Set("list_uuid", list.UUID)
		c.Next()
	}
}
