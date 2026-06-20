package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
)

// WallpaperHandler proxies the external Xiaomi weather/location APIs that the
// wallpaper preset uses. These were previously Cloudflare Pages Functions;
// ported here so the integrated app keeps working without a Cloudflare runtime.
type WallpaperHandler struct{}

const (
	xiaomiLocationSearchAPI = "https://weatherapi.market.xiaomi.com/wtr-v3/location/city/search"
	xiaomiLocationGeoAPI    = "https://weatherapi.market.xiaomi.com/wtr-v3/location/city/geo"
	xiaomiWeatherAPI        = "https://weatherapi.market.xiaomi.com/wtr-v3/weather/all"
	xiaomiAppKey            = "weather20151024"
	xiaomiSign              = "zUFJoAR2ZVrDy1vF3D07"
	xiaomiUserAgent         = "hitokoto-server-wallpaper"
)

var wallpaperHTTPClient = &http.Client{Timeout: 8 * time.Second}

// fetchXiaomiJSON performs a GET against an upstream Xiaomi URL and decodes the
// JSON body into out. It always sets the Xiaomi-expected User-Agent.
func fetchXiaomiJSON(upstreamURL string, out interface{}) error {
	req, err := http.NewRequest(http.MethodGet, upstreamURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", xiaomiUserAgent)

	resp, err := wallpaperHTTPClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return &httpStatusError{status: resp.StatusCode}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	return json.Unmarshal(body, out)
}

type httpStatusError struct{ status int }

func (e *httpStatusError) Error() string { return "upstream returned " + strconv.Itoa(e.status) }

// XiaomiLocation searches/geocodes a location. Mirrors the original Cloudflare
// function: ?q=<name> (>=2 chars) for search, or ?latitude=&longitude= for geo.
func (h *WallpaperHandler) XiaomiLocation(c *gin.Context) {
	query := c.Query("q")
	latitude := c.Query("latitude")
	longitude := c.Query("longitude")

	upstreamURL := buildXiaomiLocationURL(query, latitude, longitude)
	if upstreamURL == "" {
		c.JSON(http.StatusOK, gin.H{"results": []any{}})
		return
	}

	var payload []map[string]any
	if err := fetchXiaomiJSON(upstreamURL, &payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"results": []any{}})
		return
	}

	results := make([]gin.H, 0, len(payload))
	for _, item := range payload {
		if normalized := normalizeXiaomiLocation(item); normalized != nil {
			results = append(results, normalized)
		}
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

func buildXiaomiLocationURL(query, latitude, longitude string) string {
	params := url.Values{}
	params.Set("locale", "zh_cn")

	if len([]rune(query)) >= 2 {
		params.Set("name", query)
		return xiaomiLocationSearchAPI + "?" + params.Encode()
	}

	if isFiniteFloat(latitude) && isFiniteFloat(longitude) {
		params.Set("latitude", latitude)
		params.Set("longitude", longitude)
		return xiaomiLocationGeoAPI + "?" + params.Encode()
	}

	return ""
}

func normalizeXiaomiLocation(item map[string]any) gin.H {
	locationKey := firstNonEmptyString(item["locationKey"], item["key"])
	latitude, latOK := toFloat(item["latitude"])
	longitude, lonOK := toFloat(item["longitude"])
	if locationKey == "" || !latOK || !lonOK {
		return nil
	}

	key := firstNonEmptyString(item["key"])
	if key == "" {
		key = locationKey
	}

	return gin.H{
		"affiliation":   stringOrEmpty(item["affiliation"]),
		"key":           key,
		"latitude":      latitude,
		"locationKey":   locationKey,
		"longitude":     longitude,
		"name":          stringOrEmpty(item["name"]),
		"status":        valueOrDefault(item["status"], float64(0)),
		"timeZoneShift": valueOrDefault(item["timeZoneShift"], float64(28800)),
	}
}

// XiaomiWeather fetches current weather. Requires ?locationKey= or
// ?latitude=&longitude=. Mirrors the original Cloudflare function.
func (h *WallpaperHandler) XiaomiWeather(c *gin.Context) {
	latitude := c.Query("latitude")
	longitude := c.Query("longitude")
	locationKey := c.Query("locationKey")

	if locationKey == "" && (!isFiniteFloat(latitude) || !isFiniteFloat(longitude)) {
		c.JSON(http.StatusBadRequest, gin.H{"current": nil})
		return
	}

	params := url.Values{}
	params.Set("days", "1")
	params.Set("appKey", xiaomiAppKey)
	params.Set("sign", xiaomiSign)
	params.Set("isGlobal", "false")
	params.Set("locale", "zh_cn")
	params.Set("ts", strconv.FormatInt(time.Now().Unix(), 10))
	if locationKey != "" {
		params.Set("locationKey", locationKey)
	}
	if isFiniteFloat(latitude) {
		params.Set("latitude", latitude)
	}
	if isFiniteFloat(longitude) {
		params.Set("longitude", longitude)
	}

	var payload map[string]any
	if err := fetchXiaomiJSON(xiaomiWeatherAPI+"?"+params.Encode(), &payload); err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"current": nil})
		return
	}
	c.JSON(http.StatusOK, payload)
}

// --- small value helpers ---

func isFiniteFloat(s string) bool {
	if s == "" {
		return false
	}
	f, err := strconv.ParseFloat(s, 64)
	return err == nil && !math.IsInf(f, 0) && !math.IsNaN(f)
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case string:
		f, err := strconv.ParseFloat(n, 64)
		return f, err == nil
	default:
		return 0, false
	}
}

func stringOrEmpty(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func firstNonEmptyString(values ...any) string {
	for _, v := range values {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	return ""
}

func valueOrDefault(v any, def any) any {
	if v == nil {
		return def
	}
	return v
}

// --- User Settings (per-user wallpaper config sync) ---

// GetUserWallpaperSettings returns the wallpaper settings for the logged-in user.
// Uses the Setting model with key "wallpaper:user:<userId>".
func (h *WallpaperHandler) GetUserWallpaperSettings(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	key := fmt.Sprintf("wallpaper:user:%d", userID.(uint))
	setting, err := repository.FindSettingByKey(key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get settings"})
		return
	}

	if setting == nil {
		// No settings saved yet
		c.JSON(http.StatusOK, gin.H{"settings": nil})
		return
	}

	c.JSON(http.StatusOK, gin.H{"settings": setting.Value})
}

// SaveUserWallpaperSettings saves the wallpaper settings for the logged-in user.
// Uses the Setting model with key "wallpaper:user:<userId>".
func (h *WallpaperHandler) SaveUserWallpaperSettings(c *gin.Context) {
	userID, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	var input struct {
		Settings string `json:"settings" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "settings is required"})
		return
	}

	key := fmt.Sprintf("wallpaper:user:%d", userID.(uint))

	// Try to find existing setting
	setting, err := repository.FindSettingByKey(key)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get settings"})
		return
	}

	if setting == nil {
		// Create new setting
		setting = &model.Setting{
			Key:   key,
			Value: input.Settings,
		}
		if err := repository.CreateSetting(setting); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save settings"})
			return
		}
	} else {
		// Update existing setting
		if err := repository.UpdateSettingValue(setting, input.Settings); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save settings"})
			return
		}
	}

	c.JSON(http.StatusOK, gin.H{"success": true})
}
