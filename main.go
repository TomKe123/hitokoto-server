package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"strings"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/router"
	"hitokoto-server/backend/database"

	"github.com/gin-gonic/gin"
)

//go:embed dist/index.html dist/favicon.svg dist/assets
var staticFiles embed.FS

func main() {
	cfg := config.Load()

	gin.SetMode(gin.ReleaseMode)

	database.Connect(cfg)
	database.Migrate()

	r := router.Setup(cfg)

	setupStaticFileServing(r)

	log.Printf("Server starting on port %s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}

func setupStaticFileServing(r *gin.Engine) {
	staticSubFS, err := fs.Sub(staticFiles, "dist")
	if err != nil {
		log.Fatalf("Failed to create sub filesystem: %v", err)
	}

	// Sub-filesystem rooted at dist/assets/ for /assets/* paths
	assetsFS, err := fs.Sub(staticFiles, "dist/assets")
	if err != nil {
		log.Fatalf("Failed to create assets sub filesystem: %v", err)
	}

	// Serve /assets/* (JS, CSS, lazy chunks)
	r.GET("/assets/*filepath", gin.WrapH(
		http.StripPrefix("/assets/", http.FileServer(http.FS(assetsFS))),
	))

	// Serve root-level static files via http.FileServer to avoid redirect issues
	r.GET("/", gin.WrapH(http.FileServer(http.FS(staticSubFS))))
	r.GET("/favicon.svg", gin.WrapH(http.FileServer(http.FS(staticSubFS))))

	// SPA fallback: serve index.html for all unmatched non-API routes
	r.NoRoute(func(c *gin.Context) {
		// API 404s return JSON
		if strings.HasPrefix(c.Request.URL.Path, "/api") {
			c.JSON(404, gin.H{"error": "Not found"})
			return
		}

		// SPA fallback
		data, err := staticFiles.ReadFile("dist/index.html")
		if err != nil {
			c.AbortWithStatus(500)
			return
		}
		c.Data(200, "text/html; charset=utf-8", data)
	})
}
