package utils

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
)

// GenerateAPIKey returns a cryptographically random 64-character hex string.
func GenerateAPIKey() (string, error) {
	b := make([]byte, 32) // 32 bytes = 64 hex chars
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("failed to generate API key: %w", err)
	}
	return hex.EncodeToString(b), nil
}

// HashAPIKey returns the SHA-256 hex digest of the given key.
func HashAPIKey(key string) string {
	h := sha256.Sum256([]byte(key))
	return hex.EncodeToString(h[:])
}
