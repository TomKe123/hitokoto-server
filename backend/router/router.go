package router

import (
	"strings"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/handler"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/setup"

	"github.com/gin-gonic/gin"
)

func Setup(cfg *config.Config) *gin.Engine {
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		c.Header("Cache-Control", "no-store, no-cache, must-revalidate")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	// Block non-setup API routes when not initialized
	r.Use(func(c *gin.Context) {
		if !setup.Needed() {
			c.Next()
			return
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api/setup") {
			c.Next()
			return
		}
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.AbortWithStatusJSON(503, gin.H{"error": "Setup not complete"})
			return
		}
		c.Next()
	})

	authHandler := &handler.AuthHandler{Config: cfg}
	quoteHandler := &handler.QuoteHandler{}
	userHandler := &handler.UserHandler{}
	notificationHandler := &handler.NotificationHandler{}
	adminHandler := &handler.AdminHandler{}
	setupHandler := &handler.SetupHandler{}

	// Public routes (with rate limit)
	publicLimiter := middleware.NewRateLimiter(100, 200)
	api := r.Group("/api")
	api.Use(publicLimiter.Middleware())
	{
		// Auth
		api.POST("/auth/register", authHandler.Register)
		api.POST("/auth/login", authHandler.Login)
		api.POST("/auth/refresh", authHandler.Refresh)

		// Quotes (public)
		api.GET("/quotes", quoteHandler.List)
		api.GET("/quotes/random", quoteHandler.Random)
		api.GET("/quotes/:id", quoteHandler.GetByID)
		api.GET("/categories", quoteHandler.ListCategories)

		// Public quote submission via invite code
		api.POST("/quotes/invite", quoteHandler.CreateWithInviteCode)

		// Leaderboard
		api.GET("/leaderboard", userHandler.Leaderboard)

		// Public site config
		api.GET("/site-config", func(c *gin.Context) {
			var setting model.Setting
			anonUpload := true
			if err := database.DB.Where("key = ?", "anonymous_upload").First(&setting).Error; err == nil {
				anonUpload = setting.Value != "false"
			}
			apiBaseURL := ""
			if err := database.DB.Where("key = ?", "api_base_url").First(&setting).Error; err == nil {
				apiBaseURL = setting.Value
			}
			c.JSON(200, gin.H{"anonymous_upload": anonUpload, "api_base_url": apiBaseURL})
		})

		// Public user profiles
		api.GET("/users/:id", userHandler.GetProfile)
		api.GET("/users/:id/quotes", userHandler.GetUserQuotes)
	}

	// Protected routes (no rate limit)
	protected := r.Group("/api")
	protected.Use(middleware.AuthMiddleware(cfg))
	{
		// Auth
		protected.POST("/auth/logout", authHandler.Logout)
		protected.GET("/auth/me", authHandler.GetMe)

		// Quotes
		protected.POST("/quotes", quoteHandler.Create)
		protected.PUT("/quotes/:id", quoteHandler.Update)
		protected.DELETE("/quotes/:id", quoteHandler.Delete)

		// Users
		protected.PUT("/users/profile", userHandler.UpdateProfile)
		protected.PUT("/users/password", userHandler.ChangePassword)

		// Notifications
		protected.GET("/notifications", notificationHandler.List)
		protected.PUT("/notifications/:id/read", notificationHandler.MarkRead)
		protected.PUT("/notifications/read-all", notificationHandler.MarkAllRead)

		// User invite codes
		protected.POST("/user/invite-codes", userHandler.GenerateUserInviteCode)
		protected.GET("/user/invite-codes", userHandler.ListUserInviteCodes)
	}

	// Moderation routes (users with review permission)
	moderator := r.Group("/api")
	moderator.Use(middleware.AuthMiddleware(cfg))
	moderator.Use(middleware.RequirePermission(permissions.PermReview))
	{
		moderator.PUT("/quotes/:id/approve", quoteHandler.ApproveQuote)
		moderator.PUT("/quotes/:id/reject", quoteHandler.RejectQuote)
	}

	// Admin routes
	admin := r.Group("/api/admin")
	admin.Use(middleware.AuthMiddleware(cfg))
	admin.Use(middleware.RequireRole("admin"))
	{
		admin.POST("/invite-codes", adminHandler.CreateInviteCodes)
		admin.GET("/invite-codes", adminHandler.ListInviteCodes)
		admin.DELETE("/invite-codes/:id", adminHandler.DeleteInviteCode)
		admin.PUT("/invite-codes/:id", adminHandler.UpdateInviteCode)
		admin.POST("/import", adminHandler.ImportJSON)
		admin.GET("/quotes/stats", adminHandler.GetQuoteStats)
		admin.POST("/quotes/batch", adminHandler.BatchQuotes)
		admin.POST("/quotes/approve-all-rejected", adminHandler.ApproveAllRejected)
		admin.GET("/users", adminHandler.ListUsers)
		admin.PUT("/users/:id/unban", adminHandler.UnbanUser)
		admin.PUT("/users/:id/ban", adminHandler.BanUser)
		admin.PUT("/users/:id/permissions", adminHandler.SetUserPermissions)
		admin.GET("/settings", adminHandler.GetSettings)
		admin.PUT("/settings", adminHandler.UpdateSetting)
		admin.POST("/categories", adminHandler.CreateCategory)
		admin.PUT("/categories/:id", adminHandler.UpdateCategory)
		admin.DELETE("/categories/:id", adminHandler.DeleteCategory)
		admin.POST("/reset", setupHandler.Reset)
		admin.POST("/repair", adminHandler.RepairDatabase)
	}

	// Setup routes (available before initialization)
	r.GET("/api/setup/status", setupHandler.Status)
	r.GET("/api/setup/admin-status", setupHandler.AdminStatus)
	r.POST("/api/setup/admin", setupHandler.CreateAdmin)
	r.POST("/api/setup/import", setupHandler.Import)
	r.POST("/api/setup/database", setupHandler.DatabaseConfig)
	r.POST("/api/setup/complete", setupHandler.Complete)

	return r
}
