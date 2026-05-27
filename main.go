package main

import (
	"log"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/router"
	"hitokoto-server/backend/database"
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
