package middleware

import (
	"bytes"
	"encoding/json"
	"io"
	"strings"

	"github.com/gin-gonic/gin"
)

// PrettyJSON detects browser requests and returns indented JSON.
func PrettyJSON() gin.HandlerFunc {
	return func(c *gin.Context) {
		ua := c.GetHeader("User-Agent")
		if !looksLikeBrowser(ua) {
			c.Next()
			return
		}

		// Wrap response writer to intercept JSON output
		w := &prettyResponseWriter{body: &bytes.Buffer{}, ResponseWriter: c.Writer}
		c.Writer = w
		c.Next()

		if w.body.Len() == 0 || w.status == 0 {
			return
		}

		realWriter := w.ResponseWriter
		ct := realWriter.Header().Get("Content-Type")
		if !strings.HasPrefix(ct, "application/json") {
			realWriter.WriteHeader(w.status)
			io.Copy(realWriter, w.body)
			return
		}

		// Pretty-print JSON
		var raw any
		if err := json.Unmarshal(w.body.Bytes(), &raw); err != nil {
			realWriter.WriteHeader(w.status)
			io.Copy(realWriter, w.body)
			return
		}
		pretty, _ := json.MarshalIndent(raw, "", "  ")

		realWriter.Header().Set("Content-Type", "application/json; charset=utf-8")
		realWriter.WriteHeader(w.status)
		realWriter.Write(pretty)
	}
}

type prettyResponseWriter struct {
	gin.ResponseWriter
	body   *bytes.Buffer
	status int
}

func (w *prettyResponseWriter) WriteHeader(code int) {
	w.status = code
}

func (w *prettyResponseWriter) Write(b []byte) (int, error) {
	return w.body.Write(b)
}

func (w *prettyResponseWriter) WriteString(s string) (int, error) {
	return w.body.WriteString(s)
}

func looksLikeBrowser(ua string) bool {
	if ua == "" {
		return false
	}
	uaLower := strings.ToLower(ua)
	// Common browser indicators
	browserSignals := []string{
		"mozilla", "chrome", "safari", "firefox", "edge", "opera",
		"msie", "trident", "webkit", "gecko",
	}
	for _, s := range browserSignals {
		if strings.Contains(uaLower, s) {
			return true
		}
	}
	return false
}
