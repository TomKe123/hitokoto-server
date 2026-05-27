package config

import (
	"os"

	"github.com/joho/godotenv"
)

type Config struct {
	DBDriver         string
	DBHost           string
	DBPort           string
	DBUser           string
	DBPassword       string
	DBName           string
	DBSSLMode        string
	DBPath           string
	JWTSecret        string
	JWTRefreshSecret string
	ServerPort       string
}

func Load() *Config {
	godotenv.Load()

	return &Config{
		DBDriver:         getEnv("DB_DRIVER", "sqlite"),
		DBHost:           getEnv("DB_HOST", "localhost"),
		DBPort:           getEnv("DB_PORT", "3306"),
		DBUser:           getEnv("DB_USER", "root"),
		DBPassword:       getEnv("DB_PASSWORD", ""),
		DBName:           getEnv("DB_NAME", "hitokoto"),
		DBSSLMode:        getEnv("DB_SSLMODE", "disable"),
		DBPath:           getEnv("DB_PATH", "hitokoto.db"),
		JWTSecret:        getEnv("JWT_SECRET", "hitokoto-access-secret-key"),
		JWTRefreshSecret: getEnv("JWT_REFRESH_SECRET", "hitokoto-refresh-secret-key"),
		ServerPort:       getEnv("SERVER_PORT", "8080"),
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}
