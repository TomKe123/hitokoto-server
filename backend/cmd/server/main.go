package main

import (
	"log"

	"hitokoto-server/internal/config"
	"hitokoto-server/internal/router"
	"hitokoto-server/pkg/database"
)

func main() {
	cfg := config.Load()

	database.Connect(cfg)
	database.Migrate()
	database.Seed()

	r := router.Setup(cfg)

	log.Printf("Server starting on port %s", cfg.ServerPort)
	if err := r.Run(":" + cfg.ServerPort); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
