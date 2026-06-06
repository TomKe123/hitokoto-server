package middleware

import (
	"bytes"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"hitokoto-server/backend/cache"

	"github.com/gin-gonic/gin"
)

type responseWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w *responseWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func (w *responseWriter) WriteString(s string) (int, error) {
	w.body.WriteString(s)
	return w.ResponseWriter.WriteString(s)
}

// CacheMiddleware caches GET JSON responses by full request URI.
// Only caches 2xx responses. Skips caching when Redis is not available.
// TTL is applied per response; set ttl=0 to use default 5 minutes.
func CacheMiddleware(ttl time.Duration) gin.HandlerFunc {
	if ttl <= 0 {
		ttl = 5 * time.Minute
	}
	return func(c *gin.Context) {
		if c.Request.Method != http.MethodGet || !cache.Enabled() {
			c.Next()
			return
		}

		// Skip caching for random endpoints (prevents stale "random" results)
		if strings.Contains(c.Request.URL.Path, "/random") {
			c.Next()
			return
		}

		key := c.Request.URL.RequestURI()

		// Try serving from cache
		if cached, err := cache.GetRaw("http", key); err == nil && cached != nil {
			c.Data(http.StatusOK, "application/json; charset=utf-8", cached)
			c.Abort()
			return
		}

		// Wrap response writer to capture body
		w := &responseWriter{ResponseWriter: c.Writer, body: &bytes.Buffer{}}
		c.Writer = w
		c.Next()

		// Only cache successful JSON responses
		if c.Writer.Status() == http.StatusOK && w.body.Len() > 0 {
			if json.Valid(w.body.Bytes()) {
				cache.SetRaw("http", key, w.body.Bytes(), ttl)
			}
		}
	}
}

// CacheInvalidator returns a Gin handler that flushes cached responses
// under the given prefixes after a successful write request completes.
func CacheInvalidator(prefixes ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Next()

		if c.Writer.Status() < 200 || c.Writer.Status() >= 300 {
			return
		}
		if !cache.Enabled() {
			return
		}

		go cache.FlushAllPrefixes(prefixes...)
	}
}
