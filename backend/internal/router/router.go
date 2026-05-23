package router

import (
	"hitokoto-server/internal/config"
	"hitokoto-server/internal/handler"
	"hitokoto-server/internal/middleware"

	"github.com/gin-gonic/gin"
)

func Setup(cfg *config.Config) *gin.Engine {
	r := gin.Default()

	// CORS middleware
	r.Use(func(c *gin.Context) {
		c.Header("Access-Control-Allow-Origin", "*")
		c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		c.Header("Access-Control-Allow-Headers", "Origin, Content-Type, Authorization")
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}
		c.Next()
	})

	authHandler := &handler.AuthHandler{Config: cfg}
	quoteHandler := &handler.QuoteHandler{}
	userHandler := &handler.UserHandler{}
	adminHandler := &handler.AdminHandler{}

	// Public routes
	api := r.Group("/api")
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
	}

	// Protected routes
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
		protected.GET("/users/:id", userHandler.GetProfile)
		protected.GET("/users/:id/quotes", userHandler.GetUserQuotes)
		protected.PUT("/users/profile", userHandler.UpdateProfile)
		protected.PUT("/users/password", userHandler.ChangePassword)
	}

	// Admin routes
	admin := r.Group("/api/admin")
	admin.Use(middleware.AuthMiddleware(cfg))
	admin.Use(middleware.AdminMiddleware())
	{
		admin.POST("/invite-codes", adminHandler.CreateInviteCodes)
		admin.GET("/invite-codes", adminHandler.ListInviteCodes)
		admin.POST("/import", adminHandler.ImportJSON)
	}

	return r
}
