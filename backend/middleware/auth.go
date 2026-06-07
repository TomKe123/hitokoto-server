package middleware

import (
	"net/http"
	"strings"
	"time"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID      uint   `json:"user_id"`
	Username    string `json:"username"`
	Role        string `json:"role"`
	Permissions uint64 `json:"permissions"`
	jwt.RegisteredClaims
}

var RoleRank = map[string]int{
	"user": 1,
	"admin": 3,
}

func AuthMiddleware(cfg *config.Config) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "authorization header required"})
			c.Abort()
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || parts[0] != "Bearer" {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid authorization header format"})
			c.Abort()
			return
		}

		tokenStr := parts[1]
		claims := &Claims{}

		token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
			return []byte(cfg.JWTSecret), nil
		})

		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired access token"})
			c.Abort()
			return
		}

		// Check if user is banned
		if user, err := repository.FindUserByID(claims.UserID); err == nil && user.Status == "banned" {
			c.JSON(http.StatusForbidden, gin.H{"error": "account is banned"})
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("username", claims.Username)
		c.Set("role", claims.Role)
		c.Set("permissions", claims.Permissions)
		c.Next()
	}
}

func RequireRole(minRole string) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		userRole, _ := role.(string)

		userRank := RoleRank[userRole]
		minRank := RoleRank[minRole]

		if userRank < minRank {
			// Fallback: verify from database
			userID, _ := c.Get("user_id")
			if userID != nil {
				if user, err := repository.FindUserByID(userID.(uint)); err == nil {
					if RoleRank[user.Role] >= minRank {
						c.Set("role", user.Role)
						c.Next()
						return
					}
				}
			}
			c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
			c.Abort()
			return
		}
		c.Next()
	}
}

// RequirePermission checks that the user has the given permission bit set.
// Admin role always passes regardless of permission bits.
func RequirePermission(perm uint64) gin.HandlerFunc {
	return func(c *gin.Context) {
		role, _ := c.Get("role")
		userRole, _ := role.(string)
		if userRole == "admin" {
			c.Next()
			return
		}

		perms, _ := c.Get("permissions")
		userPerms, _ := perms.(uint64)
		if permissions.Has(userPerms, perm) {
			c.Next()
			return
		}

		// Fallback: verify from database
		userID, _ := c.Get("user_id")
		if userID != nil {
			if user, err := repository.FindUserByID(userID.(uint)); err == nil {
				if user.Role == "admin" || permissions.Has(user.Permissions, perm) {
					c.Set("role", user.Role)
					c.Set("permissions", user.Permissions)
					c.Next()
					return
				}
			}
		}

		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions"})
		c.Abort()
	}
}

// AdminMiddleware is deprecated. Use RequireRole("admin") instead.
func AdminMiddleware() gin.HandlerFunc {
	return RequireRole("admin")
}

func GenerateAccessToken(cfg *config.Config, userID uint, username, role string, perms uint64) (string, error) {
	claims := Claims{
		UserID:      userID,
		Username:    username,
		Role:        role,
		Permissions: perms,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(15 * time.Minute)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(cfg.JWTSecret))
}

func GenerateRefreshToken(cfg *config.Config, userID uint) (string, error) {
	claims := Claims{
		UserID:      userID,
		Username:    "",
		Role:        "",
		Permissions: 0,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(7 * 24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(cfg.JWTRefreshSecret))
}

func ValidateRefreshToken(cfg *config.Config, tokenStr string) (uint, error) {
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(token *jwt.Token) (interface{}, error) {
		return []byte(cfg.JWTRefreshSecret), nil
	})

	if err != nil || !token.Valid {
		return 0, err
	}

	return claims.UserID, nil
}
