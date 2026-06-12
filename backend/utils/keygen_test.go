package utils

import (
	"strings"
	"testing"
)

func TestGenerateAPIKey_Length(t *testing.T) {
	key, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(key) != 64 {
		t.Fatalf("expected key length 64, got %d", len(key))
	}
}

func TestGenerateAPIKey_HexChars(t *testing.T) {
	key, err := GenerateAPIKey()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for _, c := range key {
		if !strings.ContainsRune("0123456789abcdef", c) {
			t.Fatalf("unexpected character %c in key %s", c, key)
		}
	}
}

func TestGenerateAPIKey_Uniqueness(t *testing.T) {
	keys := make(map[string]bool)
	for i := 0; i < 100; i++ {
		key, err := GenerateAPIKey()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if keys[key] {
			t.Fatalf("duplicate key generated: %s", key)
		}
		keys[key] = true
	}
}

func TestHashAPIKey_Deterministic(t *testing.T) {
	key := "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890"
	h1 := HashAPIKey(key)
	h2 := HashAPIKey(key)
	if h1 != h2 {
		t.Fatal("hash should be deterministic")
	}
}

func TestHashAPIKey_Length(t *testing.T) {
	key, _ := GenerateAPIKey()
	hash := HashAPIKey(key)
	if len(hash) != 64 {
		t.Fatalf("expected SHA-256 hex length 64, got %d", len(hash))
	}
}

func TestHashAPIKey_DifferentKeys(t *testing.T) {
	k1, _ := GenerateAPIKey()
	k2, _ := GenerateAPIKey()
	if HashAPIKey(k1) == HashAPIKey(k2) {
		t.Fatal("different keys should produce different hashes")
	}
}
