package router

import (
	"strings"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/handler"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"
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

	// Pretty-print JSON for browser requests
	r.Use(middleware.PrettyJSON())

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
	listHandler := &handler.ListHandler{}
	orgHandler := &handler.OrganizationHandler{}
	orgMemberHandler := &handler.OrganizationMemberHandler{}
	orgInviteHandler := &handler.OrganizationInviteHandler{}
	wallpaperHandler := &handler.WallpaperHandler{}

	// Public routes (with rate limit)
	publicLimiter := middleware.NewRateLimiter(100, 200)
	api := r.Group("/api")
	api.Use(publicLimiter.Middleware())
	api.Use(middleware.AnonymousSession())
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

		// Pie chart stats
		api.GET("/quotes/stats/pie", quoteHandler.StatsPie)

		// Public user profiles
		api.GET("/users/:id", userHandler.GetProfile)
		api.GET("/users/:id/quotes", userHandler.GetUserQuotes)

		// Wallpaper preset external-data proxy (weather/location)
		api.GET("/wallpaper/xiaomi-location", wallpaperHandler.XiaomiLocation)
		api.GET("/wallpaper/xiaomi-weather", wallpaperHandler.XiaomiWeather)
	}

	// Site config (uncached — must always return the latest value)
	siteConfig := r.Group("/api")
	siteConfig.Use(publicLimiter.Middleware())
	siteConfig.Use(middleware.AnonymousSession())
	{
		siteConfig.GET("/site-config", func(c *gin.Context) {
			anonUpload := true
			if s, err := repository.FindSettingByKey("anonymous_upload"); err == nil && s != nil {
				anonUpload = s.Value != "false"
			}
			apiBaseURL := ""
			if s, err := repository.FindSettingByKey("api_base_url"); err == nil && s != nil {
				apiBaseURL = s.Value
			}
			c.JSON(200, gin.H{"anonymous_upload": anonUpload, "api_base_url": apiBaseURL})
		})
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
		protected.GET("/users/search", userHandler.SearchUsers)

		// Notifications
		protected.GET("/notifications", notificationHandler.List)
		protected.PUT("/notifications/:id/read", notificationHandler.MarkRead)
		protected.PUT("/notifications/read-all", notificationHandler.MarkAllRead)

		// User invite codes
		protected.POST("/user/invite-codes", userHandler.GenerateUserInviteCode)
		protected.GET("/user/invite-codes", userHandler.ListUserInviteCodes)

		// Quote lists
		protected.POST("/lists", listHandler.CreateList)
		protected.GET("/lists", listHandler.GetOwnLists)
		protected.GET("/lists/:id", listHandler.GetList)
		protected.PUT("/lists/:id", listHandler.UpdateList)
		protected.DELETE("/lists/:id", listHandler.DeleteList)
		protected.POST("/lists/:id/items", listHandler.AddItems)
		protected.DELETE("/lists/:id/items/:itemId", listHandler.RemoveItem)
		protected.PUT("/lists/:id/items/reorder", listHandler.ReorderItems)
		protected.POST("/lists/:id/regenerate-key", listHandler.RegenerateKey)
		protected.GET("/lists/:id/references", listHandler.GetReferences)
		protected.POST("/lists/:id/references", listHandler.AddReference)
		protected.DELETE("/lists/:id/references/:refId", listHandler.RemoveReference)

		// Organizations
		protected.POST("/organizations", orgHandler.CreateOrganization)
		protected.GET("/organizations/mine", orgHandler.GetMyOrganizations)
		protected.GET("/organizations", orgHandler.ListOrganizations)
		protected.GET("/organizations/:id", orgHandler.GetOrganization)
		protected.PUT("/organizations/:id", orgHandler.UpdateOrganization)
		protected.DELETE("/organizations/:id", orgHandler.DeleteOrganization)
		protected.POST("/organizations/:id/transfer", orgHandler.TransferOwnership)
		protected.GET("/organizations/:id/lists", orgHandler.GetOrganizationLists)

		// Organization members
		protected.GET("/organizations/:id/members", orgHandler.GetOrganizationMembers)
		protected.POST("/organizations/:id/members", orgMemberHandler.AddMember)
		protected.DELETE("/organizations/:id/members/:memberId", orgMemberHandler.RemoveMember)
		protected.PUT("/organizations/:id/members/:memberId/role", orgMemberHandler.ChangeMemberRole)
		protected.POST("/organizations/:id/leave", orgMemberHandler.LeaveOrganization)

		// Organization invites
		protected.POST("/organizations/:id/invites", orgInviteHandler.CreateInvitation)
		protected.GET("/organizations/:id/invites", orgInviteHandler.ListInvitations)
		protected.DELETE("/organizations/:id/invites/:inviteId", orgInviteHandler.RevokeInvitation)
		protected.POST("/invites/accept", orgInviteHandler.AcceptInvitation)
		protected.GET("/invites/pending", orgInviteHandler.ListMyPendingInvites)
		protected.POST("/invites/:inviteId/accept", orgInviteHandler.AcceptTargetedInvite)
		protected.POST("/invites/:inviteId/decline", orgInviteHandler.DeclineInvite)
	}

	// Moderation routes (users with review permission)
	moderator := r.Group("/api")
	moderator.Use(middleware.AuthMiddleware(cfg))
	moderator.Use(middleware.RequirePermission(permissions.PermReview))
	{
		moderator.PUT("/quotes/:id/approve", quoteHandler.ApproveQuote)
		moderator.PUT("/quotes/:id/reject", quoteHandler.RejectQuote)
	}

	// Admin + Moderator shared routes (stats, batch — reviewers can access, admins too via RequirePermission allowing admin)
	adminShared := r.Group("/api/admin")
	adminShared.Use(middleware.AuthMiddleware(cfg))
	adminShared.Use(middleware.RequirePermission(permissions.PermReview))
	{
		adminShared.GET("/quotes/stats", adminHandler.GetQuoteStats)
		adminShared.POST("/quotes/batch", adminHandler.BatchQuotes)
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
		admin.POST("/quotes/approve-all-rejected", adminHandler.ApproveAllRejected)
		admin.GET("/users", adminHandler.ListUsers)
		admin.POST("/users", adminHandler.AddUser)
		admin.PUT("/users/:id/reset-password", adminHandler.ResetUserPassword)
		admin.PUT("/users/:id/unban", adminHandler.UnbanUser)
		admin.PUT("/users/:id/ban", adminHandler.BanUser)
		admin.PUT("/users/:id/permissions", adminHandler.SetUserPermissions)
		admin.GET("/settings", adminHandler.GetSettings)
		admin.PUT("/settings", adminHandler.UpdateSetting)
		admin.POST("/reset", setupHandler.Reset)
		admin.POST("/repair", adminHandler.RepairDatabase)
	}

	// List management routes (users with manage_lists permission)
	listAdmin := r.Group("/api/admin")
	listAdmin.Use(middleware.AuthMiddleware(cfg))
	listAdmin.Use(middleware.RequirePermission(permissions.PermManageLists))
	{
		listAdmin.GET("/lists", adminHandler.ListAllLists)
		listAdmin.DELETE("/lists/:id", adminHandler.AdminDeleteList)
		listAdmin.PUT("/lists/:id/block", adminHandler.BlockList)
		listAdmin.PUT("/lists/:id/unblock", adminHandler.UnblockList)
	}

	// Category management routes (users with category permission)
	catAdmin := r.Group("/api/admin")
	catAdmin.Use(middleware.AuthMiddleware(cfg))
	catAdmin.Use(middleware.RequirePermission(permissions.PermCategory))
	{
		catAdmin.POST("/categories", adminHandler.CreateCategory)
		catAdmin.PUT("/categories/:id", adminHandler.UpdateCategory)
		catAdmin.DELETE("/categories/:id", adminHandler.DeleteCategory)
	}

	// Global admin routes (users with global admin permission)
	globalAdmin := r.Group("/api/admin")
	globalAdmin.Use(middleware.AuthMiddleware(cfg))
	globalAdmin.Use(handler.RequireGlobalAdmin())
	{
		globalAdmin.GET("/organizations", orgHandler.ListOrganizations)
		globalAdmin.DELETE("/organizations/:id", orgHandler.DeleteOrganization)
		globalAdmin.POST("/users/:id/global-admin", adminHandler.GrantGlobalAdmin)
		globalAdmin.DELETE("/users/:id/global-admin", adminHandler.RevokeGlobalAdmin)
	}

	// Public lists (rate-limited, with optional API key for private lists)
	publicLists := r.Group("/api/public")
	publicLists.Use(publicLimiter.Middleware())
	publicLists.Use(middleware.ListKeyMiddleware())
	{
		publicLists.GET("/lists/:uuid", listHandler.GetPublicList)
	}

	// Public lists listing (no key middleware — just rate limit)
	publicListBrowse := r.Group("/api/public")
	publicListBrowse.Use(publicLimiter.Middleware())
	{
		publicListBrowse.GET("/lists", listHandler.ListPublicLists)
	publicListBrowse.GET("/lists/search", listHandler.SearchPublicLists)
	}

	// Public random quote from list (rate-limited, with anonymous session for dedup)
	// ?list=UUID  &key=API_KEY (required for private lists)  &token=... (dedup)
	publicRandom := r.Group("/api/public")
	publicRandom.Use(publicLimiter.Middleware())
	publicRandom.Use(middleware.AnonymousSession())
	{
		publicRandom.GET("/random", listHandler.GetRandomFromList)
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
