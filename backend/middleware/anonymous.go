package middleware

import (
	"hitokoto-server/backend/cache"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// AnonymousSession ensures every request without a JWT token gets an
// X-Anonymous-Token that persists until midnight. This token is used to
// track seen quotes so the random endpoint can avoid returning duplicates.
func AnonymousSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip if user is authenticated via JWT
		if _, exists := c.Get("user_id"); exists {
			c.Next()
			return
		}

		token := c.GetHeader("X-Anonymous-Token")
		if token == "" {
			token = c.Query("_anon")
		}
		if token == "" {
			token = uuid.New().String()
		}

		c.Set("anonymous_token", token)
		c.Header("X-Anonymous-Token", token)

		c.Next()
	}
}

// seenSetKey builds the Redis key for an anonymous session's seen-quotes set.
func seenSetKey(token string) string {
	return cache.Key("anon_seen", token)
}

// RecordSeenQuote adds a quote UUID to the anonymous session's seen set.
// The set auto-expires at midnight.
func RecordSeenQuote(token, quoteUUID string) {
	if !cache.Enabled() {
		return
	}
	cache.SAdd(seenSetKey(token), quoteUUID)
}

// GetSeenQuotes returns all quote UUIDs already seen by this anonymous session.
func GetSeenQuotes(token string) ([]string, error) {
	if !cache.Enabled() {
		return nil, nil
	}
	return cache.SMembers(seenSetKey(token))
}
