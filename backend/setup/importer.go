package setup

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
)

const cdnBase = "https://cdn.jsdelivr.net/gh/hitokoto-osc/sentences-bundle@latest/sentences"

type cdnEntry struct {
	ID        int    `json:"id"`
	UUID      string `json:"uuid"`
	Hitokoto  string `json:"hitokoto"`
	Type      string `json:"type"`
	From      string `json:"from"`
	FromWho   string `json:"from_who"`
	Creator   string `json:"creator"`
	CreatorID int    `json:"creator_id"`
	CreatedAt string `json:"created_at"`
}

type ImportResult struct {
	Total   int
	Files   int
	Skipped int
	Err     error
}

var categoryMap = map[string]string{
	"a": "anime",
	"b": "comic",
	"c": "game",
	"d": "novel",
	"e": "movie",
	"f": "music",
	"g": "other",
	"h": "other",
	"i": "other",
	"j": "other",
	"k": "other",
	"l": "other",
}

func ImportFromCDN() ImportResult {
	files, err := fetchJSONFileList()
	if err != nil {
		return ImportResult{Err: fmt.Errorf("fetching file list: %w", err)}
	}

	if len(files) == 0 {
		return ImportResult{Err: fmt.Errorf("no JSON files found at CDN directory")}
	}

	total := 0
	skipped := 0

	for _, file := range files {
		imported, skip, err := importFile(file)
		if err != nil {
			fmt.Printf("  [!] %s: %v\n", file, err)
			continue
		}
		total += imported
		skipped += skip
		fmt.Printf("  [OK] %s: %d imported", file, imported)
		if skip > 0 {
			fmt.Printf(" (%d skipped)", skip)
		}
		fmt.Println()
	}

	return ImportResult{Total: total, Files: len(files), Skipped: skipped}
}

func fetchJSONFileList() ([]string, error) {
	resp, err := http.Get(cdnBase + "/")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	re := regexp.MustCompile(`href="[^"]*?sentences/([a-zA-Z0-9_-]+\.json)"`)
	matches := re.FindAllStringSubmatch(string(body), -1)

	seen := map[string]bool{}
	var files []string
	for _, m := range matches {
		name := m[1]
		if !seen[name] {
			seen[name] = true
			files = append(files, name)
		}
	}
	return files, nil
}

func importFile(filename string) (imported, skipped int, err error) {
	url := cdnBase + "/" + filename
	resp, err := http.Get(url)
	if err != nil {
		return 0, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return 0, 0, err
	}

	var entries []cdnEntry
	if err := json.Unmarshal(body, &entries); err != nil {
		return 0, 0, fmt.Errorf("parse JSON: %w", err)
	}

	for _, entry := range entries {
		content := strings.TrimSpace(entry.Hitokoto)
		if content == "" {
			skipped++
			continue
		}

		from := entry.From
		if entry.FromWho != "" {
			if from != "" {
				from = from + " - " + entry.FromWho
			} else {
				from = entry.FromWho
			}
		}

		category := categoryMap[entry.Type]
		if category == "" {
			category = "other"
		}

		// Check duplicate by UUID
		if entry.UUID != "" {
			var count int64
			database.DB.Model(&model.Quote{}).Where("uuid = ?", entry.UUID).Count(&count)
			if count > 0 {
				skipped++
				continue
			}
		}

		quote := model.Quote{
			Content:  content,
			From:     from,
			Category: category,
			Status:   "approved",
		}
		if entry.UUID != "" {
			quote.UUID = entry.UUID
		}
		if entry.CreatorID > 0 {
			quote.ContributorID = uint(entry.CreatorID)
		}

		if err := database.DB.Create(&quote).Error; err != nil {
			skipped++
			continue
		}
		imported++
	}

	return imported, skipped, nil
}
