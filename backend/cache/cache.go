package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"hitokoto-server/backend/config"

	"github.com/redis/go-redis/v9"
)

var Client *redis.Client
var ctx = context.Background()

const defaultTTL = 5 * time.Minute

// Init initializes the Redis client from config.
// Skips initialization silently if RedisAddr is empty (no Redis configured).
func Init(cfg *config.Config) {
	if cfg.RedisAddr == "" {
		log.Println("Redis addr not set, caching disabled")
		Client = nil
		return
	}

	Client = redis.NewClient(&redis.Options{
		Addr:     cfg.RedisAddr,
		Password: cfg.RedisPassword,
		DB:       cfg.RedisDB,
	})

	// Verify connection
	if err := Client.Ping(ctx).Err(); err != nil {
		log.Printf("Redis connection failed (%v), caching disabled", err)
		Client = nil
		return
	}

	log.Printf("Redis connected (%s, db %d)", cfg.RedisAddr, cfg.RedisDB)
}

// Enabled returns true when Redis is connected and ready.
func Enabled() bool {
	return Client != nil
}

// key builds a namespaced cache key.
func key(parts ...string) string {
	k := "hitokoto"
	for _, p := range parts {
		k = k + ":" + p
	}
	return k
}

// GetJSON fetches a cached value and unmarshals it into dest.
// dest must be a pointer (e.g. &[]gin.H{}).
func GetJSON(prefix string, id string, dest interface{}) error {
	if !Enabled() {
		return fmt.Errorf("cache not available")
	}
	data, err := Client.Get(ctx, key(prefix, id)).Bytes()
	if err != nil {
		return err
	}
	return json.Unmarshal(data, dest)
}

// SetJSON marshals v and stores it in Redis with the given TTL.
func SetJSON(prefix string, id string, v interface{}, ttl time.Duration) error {
	if !Enabled() {
		return nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return Client.Set(ctx, key(prefix, id), data, ttl).Err()
}

// GetRaw fetches raw bytes from cache. Returns nil if not found.
func GetRaw(prefix string, id string) ([]byte, error) {
	if !Enabled() {
		return nil, fmt.Errorf("cache not available")
	}
	return Client.Get(ctx, key(prefix, id)).Bytes()
}

// SetRaw stores raw bytes directly (no JSON marshalling).
func SetRaw(prefix string, id string, data []byte, ttl time.Duration) error {
	if !Enabled() {
		return nil
	}
	return Client.Set(ctx, key(prefix, id), data, ttl).Err()
}

// Delete removes one or more specific cache keys by prefix and IDs.
func Delete(prefix string, ids ...string) {
	if !Enabled() || len(ids) == 0 {
		return
	}
	keys := make([]string, len(ids))
	for i, id := range ids {
		keys[i] = key(prefix, id)
	}
	Client.Del(ctx, keys...)
}

// FlushPrefix deletes all keys matching a pattern (e.g. "hitokoto:leaderboard:*").
// Uses SCAN for safe iteration over large key sets.
func FlushPrefix(prefix string) {
	if !Enabled() {
		return
	}
	pattern := key(prefix) + ":*"
	iter := Client.Scan(ctx, 0, pattern, 0).Iterator()
	var batch []string
	for iter.Next(ctx) {
		batch = append(batch, iter.Val())
		if len(batch) >= 100 {
			Client.Del(ctx, batch...)
			batch = batch[:0]
		}
	}
	if len(batch) > 0 {
		Client.Del(ctx, batch...)
	}
}

// FlushAllPrefixes clears every key under the given top-level prefix patterns.
func FlushAllPrefixes(prefixes ...string) {
	for _, p := range prefixes {
		FlushPrefix(p)
	}
}
