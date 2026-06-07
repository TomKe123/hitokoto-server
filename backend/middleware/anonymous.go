package middleware

import (
	"time"

	"hitokoto-server/backend/repository"
	"hitokoto-server/backend/model"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func init() {
	go cleanupLoop()
}

// cleanupLoop deletes seen-quote records older than 24h, daily at midnight.
func cleanupLoop() {
	for {
		now := time.Now()
		midnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, now.Location())
		time.Sleep(midnight.Sub(now))

		repository.DeleteExpiredSeenQuotes()
	}
}

// AnonymousSession reads the token query parameter as the session identifier.
// If absent, generates a new UUID. The token is stored in gin context for
// downstream handlers to retrieve (c.Get("anonymous_token")).
func AnonymousSession() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Skip if user is authenticated via JWT
		if _, exists := c.Get("user_id"); exists {
			c.Next()
			return
		}

		token := c.Query("token")
		if token == "" {
			token = uuid.New().String()
		}

		c.Set("anonymous_token", token)
		c.Next()
	}
}

// RecordSeenQuote inserts a seen-quote record for an anonymous session.
func RecordSeenQuote(token, quoteUUID string) {
	if token == "" || quoteUUID == "" {
		return
	}
	repository.CreateSeenQuote(&model.SeenQuote{
		Token:     token,
		QuoteUUID: quoteUUID,
	})
}

// GetSeenQuotes returns all quote UUIDs already seen by this anonymous session.
func GetSeenQuotes(token string) ([]string, error) {
	if token == "" {
		return nil, nil
	}
	records, err := repository.FindSeenQuotesByToken(token)
	if err != nil {
		return nil, err
	}
	result := make([]string, 0, len(records))
	for _, r := range records {
		result = append(result, r.QuoteUUID)
	}
	return result, nil
}
