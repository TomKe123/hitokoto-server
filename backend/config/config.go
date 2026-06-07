package config

import (
	"fmt"
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
		ServerPort:       getEnv("SERVER_PORT", "7070"),
	}
}

func getEnv(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := parseInt(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func parseInt(s string) (int, error) {
	var n int
	for _, c := range s {
		if c < '0' || c > '9' {
			return 0, fmt.Errorf("not a number: %s", s)
		}
		n = n*10 + int(c-'0')
	}
	return n, nil
}
