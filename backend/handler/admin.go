package handler

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"strconv"
	"time"

	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
)

type AdminHandler struct{}

func generateCode(length int) string {
	b := make([]byte, length)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (h *AdminHandler) CreateInviteCodes(c *gin.Context) {
	var input struct {
		Count      int    `json:"count" binding:"required,min=1,max=100"`
		MaxUses    int    `json:"max_uses"`
		CustomCode string `json:"custom_code"`
		ExpireDays int    `json:"expire_days"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.MaxUses < 1 {
		input.MaxUses = 1
	}

	userID := c.GetUint("user_id")

	codes := make([]gin.H, 0)
	count := input.Count
	customCodes := []string{}

	if input.CustomCode != "" {
		count = 1
		customCodes = append(customCodes, input.CustomCode)
	}

	for i := 0; i < count; i++ {
		codeStr := ""
		if i < len(customCodes) {
			codeStr = customCodes[i]
		} else {
			codeStr = generateCode(8)
		}

		var expiresAt *time.Time
		if input.ExpireDays > 0 {
			t := time.Now().Add(time.Duration(input.ExpireDays) * 24 * time.Hour)
			expiresAt = &t
		}

		code := model.InviteCode{
			Code:      codeStr,
			MaxUses:   input.MaxUses,
			CreatedBy: userID,
			ExpiresAt: expiresAt,
		}
		if err := repository.CreateInviteCode(&code); err != nil {
			continue
		}
		resp := gin.H{
			"id":       code.ID,
			"code":     code.Code,
			"max_uses": code.MaxUses,
		}
		if code.ExpiresAt != nil {
			resp["expires_at"] = code.ExpiresAt
		}
		codes = append(codes, resp)
	}

	c.JSON(http.StatusCreated, gin.H{"codes": codes})
}

func (h *AdminHandler) ListInviteCodes(c *gin.Context) {
	codes, _ := repository.ListInviteCodes()

	result := make([]gin.H, 0)
	for _, ic := range codes {
		item := gin.H{
			"id":         ic.ID,
			"code":       ic.Code,
			"max_uses":   ic.MaxUses,
			"use_count":  ic.UseCount,
			"created_by": ic.CreatedBy,
			"created_at": ic.CreatedAt,
		}
		if ic.ExpiresAt != nil {
			item["expires_at"] = ic.ExpiresAt
		}
		result = append(result, item)
	}

	c.JSON(http.StatusOK, gin.H{"codes": result})
}

func (h *AdminHandler) DeleteInviteCode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	rows, err := repository.DeleteInviteCodeByID(uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete"})
		return
	}
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "invite code not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *AdminHandler) UpdateInviteCode(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var input struct {
		MaxUses    int  `json:"max_uses"`
		ExpireDays int  `json:"expire_days"`
		ResetUse   bool `json:"reset_use"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	code, err := repository.FindInviteCodeByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "invite code not found"})
		return
	}

	updates := map[string]interface{}{}
	if input.MaxUses > 0 {
		updates["max_uses"] = input.MaxUses
	}
	if input.ExpireDays > 0 {
		t := time.Now().Add(time.Duration(input.ExpireDays) * 24 * time.Hour)
		updates["expires_at"] = &t
	} else if input.ExpireDays == -1 {
		updates["expires_at"] = nil
	}
	if input.ResetUse {
		updates["use_count"] = 0
	}

	if len(updates) > 0 {
		repository.UpdateInviteCode(code, updates)
	}

	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

type hitokotoEntry struct {
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

func (h *AdminHandler) ImportJSON(c *gin.Context) {
	userID := c.GetUint("user_id")

	var entries []hitokotoEntry
	if err := c.ShouldBindJSON(&entries); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid JSON format, expected array"})
		return
	}

	if len(entries) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "empty array"})
		return
	}

	var (
		imported int
		skipped  int
	)

	for _, entry := range entries {
		content := entry.Hitokoto
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

		category := entry.Type
		if category == "" {
			category = "other"
		}

		categoryMap := map[string]string{
			"a": "anime", "b": "comic", "c": "game", "d": "novel",
			"e": "movie", "f": "music", "g": "other", "h": "other",
			"i": "other", "j": "other", "k": "other", "l": "other",
		}
		if mapped, ok := categoryMap[category]; ok {
			category = mapped
		}

		if entry.UUID != "" {
			exists, _ := repository.QuoteExistsByUUID(entry.UUID)
			if exists {
				skipped++
				continue
			}
		}

		quote := model.Quote{
			UUID:          entry.UUID,
			Content:       content,
			From:          from,
			Category:      category,
			ContributorID: int64(userID),
		}
		if quote.UUID == "" {
			quote.UUID = generateCode(16)
		}

		if err := repository.CreateQuote(&quote); err != nil {
			skipped++
			continue
		}
		imported++
	}

	c.JSON(http.StatusOK, gin.H{
		"imported": imported,
		"skipped":  skipped,
		"total":    len(entries),
	})
}

func (h *AdminHandler) ListUsers(c *gin.Context) {
	page := 1
	pageSize := 20
	role := c.Query("role")
	status := c.Query("status")

	if p, err := strconv.Atoi(c.Query("page")); err == nil && p > 0 {
		page = p
	}
	if ps, err := strconv.Atoi(c.Query("page_size")); err == nil && ps > 0 && ps <= 100 {
		pageSize = ps
	}

	query := repository.UsersQuery()
	if role != "" {
		query = query.Where("role = ?", role)
	}
	if status != "" {
		query = query.Where("status = ?", status)
	}

	var total int64
	query.Count(&total)

	var users []model.User
	offset := (page - 1) * pageSize
	query.Order("id ASC").Offset(offset).Limit(pageSize).Find(&users)

	results := make([]gin.H, 0)
	for _, u := range users {
		results = append(results, gin.H{
			"id":          u.ID,
			"username":    u.Username,
			"email":       u.Email,
			"role":        u.Role,
			"permissions": u.Permissions,
			"status":      u.Status,
			"created_at":  u.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"users":       results,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

func (h *AdminHandler) BanUser(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	target, err := repository.FindUserByID(uint(targetID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	userID := c.GetUint("user_id")

	if target.ID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot ban yourself"})
		return
	}

	if target.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot ban admin user"})
		return
	}

	if target.Status == "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user is already banned"})
		return
	}

	if err := repository.UpdateUserField(target, "status", "banned"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to ban user: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user banned successfully"})
}

func (h *AdminHandler) UnbanUser(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	target, err := repository.FindUserByID(uint(targetID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if target.Status != "banned" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user is not banned"})
		return
	}

	if err := repository.UpdateUserField(target, "status", "active"); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unban user: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user unbanned successfully"})
}

func (h *AdminHandler) SetUserPermissions(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	userID := c.GetUint("user_id")
	if uint(targetID) == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot change your own permissions"})
		return
	}

	var input struct {
		Permissions uint64 `json:"permissions"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	target, err := repository.FindUserByID(uint(targetID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	if target.Role == "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "cannot change admin permissions"})
		return
	}

	if err := repository.UpdateUserField(target, "permissions", input.Permissions|permissions.PermUpload); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update permissions: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user permissions updated successfully"})
}

func (h *AdminHandler) ResetUserPassword(c *gin.Context) {
	targetID, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid user id"})
		return
	}

	userID := c.GetUint("user_id")
	if uint(targetID) == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cannot reset your own password, use the change password endpoint"})
		return
	}

	target, err := repository.FindUserByID(uint(targetID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	newPassword := generatePassword(8)
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	if err := repository.UpdateUserField(target, "password_hash", string(hashedPassword)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reset password: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "password reset successfully",
		"user_id":  target.ID,
		"username": target.Username,
		"password": newPassword,
	})
}

func (h *AdminHandler) AddUser(c *gin.Context) {
	var input struct {
		Username string `json:"username" binding:"required,min=3,max=50"`
		Email    string `json:"email"`
		Password string `json:"password"` // optional; generated if empty
		Role     string `json:"role"`     // "user" (default) or "admin"
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !isValidUsername(input.Username) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username can only contain letters, numbers, and underscores"})
		return
	}

	if _, err := repository.FindUserByUsername(input.Username); err == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username already exists"})
		return
	}

	if input.Email != "" {
		if _, err := repository.FindUserByEmail(input.Email); err == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "email already exists"})
			return
		}
	}

	// Role defaults to "user"
	role := input.Role
	if role != "user" && role != "admin" {
		role = "user"
	}

	// Use provided password or generate one
	plainPassword := input.Password
	if plainPassword == "" {
		plainPassword = generatePassword(8)
	} else if len(plainPassword) < 8 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "password must be at least 8 characters"})
		return
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(plainPassword), bcrypt.DefaultCost)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to hash password"})
		return
	}

	perm := permissions.PermUpload
	if role == "admin" {
		perm = permissions.PermAll
	}

	user := model.User{
		Username:     input.Username,
		Email:        input.Email,
		PasswordHash: string(hashedPassword),
		Role:         role,
		Permissions:  perm,
	}

	if err := repository.CreateUser(&user); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create user: " + err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "user created successfully",
		"user": gin.H{
			"id":          user.ID,
			"username":    user.Username,
			"email":       user.Email,
			"role":        user.Role,
			"permissions": user.Permissions,
			"created_at":  user.CreatedAt,
		},
		"password": plainPassword,
	})
}

func generatePassword(length int) string {
	const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	b := make([]byte, length)
	rand.Read(b)
	for i := range b {
		b[i] = charset[int(b[i])%len(charset)]
	}
	return string(b)
}

func (h *AdminHandler) RepairDatabase(c *gin.Context) {
	var report []string

	affected := repository.GrantDefaultPermissions()
	if affected > 0 {
		report = append(report, "已为 "+strconv.FormatInt(affected, 10)+" 个用户补全默认上传权限")
	}

	adminFixed := repository.FixAdminPermissions()
	if adminFixed > 0 {
		report = append(report, "已修复 "+strconv.FormatInt(adminFixed, 10)+" 个管理员的权限")
	}

	orphanFixed := repository.FixOrphanedContributorIDs()
	_ = orphanFixed // no-op: contributor_id=0 is now 官方源

	if len(report) == 0 {
		report = append(report, "数据库无需修复")
	}

	c.JSON(http.StatusOK, gin.H{"message": report})
}

func (h *AdminHandler) BatchQuotes(c *gin.Context) {
	var input struct {
		Action string   `json:"action" binding:"required"`
		UUIDs  []string `json:"uuids" binding:"required,min=1,max=1000"`
		Reason string   `json:"reason"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if input.Action != "approve" && input.Action != "reject" && input.Action != "delete" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid action, must be 'approve', 'reject', or 'delete'"})
		return
	}

	userRole := c.GetString("role")
	userPerms, _ := c.Get("permissions")
	perms, _ := userPerms.(uint64)

	// Only admins or users with PermDeleteQuote can batch-delete
	if input.Action == "delete" && userRole != "admin" && !permissions.Has(perms, permissions.PermDeleteQuote) {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions to delete quotes"})
		return
	}

	// approve/reject require PermReview (already checked by middleware, but double-check for non-admins)
	if input.Action != "delete" && userRole != "admin" && !permissions.Has(perms, permissions.PermReview) {
		c.JSON(http.StatusForbidden, gin.H{"error": "insufficient permissions to moderate quotes"})
		return
	}

	var affected int64
	if input.Action == "delete" {
		var err error
		affected, err = repository.DeleteQuotesByUUIDs(input.UUIDs)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "batch delete failed: " + err.Error()})
			return
		}
	} else {
		status := "approved"
		if input.Action == "reject" {
			status = "rejected"
		}
		var err error
		affected, err = repository.BatchUpdateQuoteStatus(input.UUIDs, status)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "batch update failed: " + err.Error()})
			return
		}

		if input.Action == "reject" {
			quotes, _ := repository.FindQuotesByUUIDs(input.UUIDs)
			for _, q := range quotes {
				notifContent := "您的语录「" + truncateText(q.Content, 50) + "」未通过审核。"
				if input.Reason != "" {
					notifContent += "原因：" + input.Reason
				}
				createNotification(q.ContributorID, q.UUID, "rejected",
					"语录未通过审核", notifContent)
			}
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"message":  "batch operation completed",
		"affected": affected,
		"total":    len(input.UUIDs),
	})
}

func (h *AdminHandler) ApproveAllRejected(c *gin.Context) {
	affected, err := repository.ApproveAllRejected()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"message":  "all rejected quotes approved",
		"affected": affected,
	})
}

func (h *AdminHandler) GetQuoteStats(c *gin.Context) {
	stats, err := repository.GetQuoteStats()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to get stats: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"all":      stats.All,
		"pending":  stats.Pending,
		"approved": stats.Approved,
		"rejected": stats.Rejected,
	})
}

func (h *AdminHandler) GetSettings(c *gin.Context) {
	settings, err := repository.ListSettings()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list settings: " + err.Error()})
		return
	}

	result := make(map[string]string)
	for _, s := range settings {
		result[s.Key] = s.Value
	}
	c.JSON(http.StatusOK, gin.H{"settings": result})
}

func (h *AdminHandler) UpdateSetting(c *gin.Context) {
	var input struct {
		Key   string `json:"key" binding:"required"`
		Value string `json:"value" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	setting, err := repository.FindSettingByKey(input.Key)
	if err != nil || setting == nil {
		setting = &model.Setting{Key: input.Key, Value: input.Value}
		if err := repository.CreateSetting(setting); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create setting: " + err.Error()})
			return
		}
	} else {
		if err := repository.UpdateSettingValue(setting, input.Value); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update setting: " + err.Error()})
			return
		}
		if err := repository.ReloadSetting(setting); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to reload setting: " + err.Error()})
			return
		}
	}
	c.JSON(http.StatusOK, gin.H{"setting": setting})
}

func (h *AdminHandler) CreateCategory(c *gin.Context) {
	var input struct {
		Name        string `json:"name" binding:"required,min=1,max=50"`
		DisplayName string `json:"display_name" binding:"max=50"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cat := model.Category{Name: input.Name, DisplayName: input.DisplayName}
	if err := repository.CreateCategory(&cat); err != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "category already exists"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"category": gin.H{"id": cat.ID, "name": cat.Name, "display_name": cat.DisplayName}})
}

func (h *AdminHandler) UpdateCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var input struct {
		Name        string `json:"name" binding:"required,min=1,max=50"`
		DisplayName string `json:"display_name" binding:"max=50"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	cat, err := repository.FindCategoryByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}

	updates := map[string]interface{}{"name": input.Name}
	if input.DisplayName != "" {
		updates["display_name"] = input.DisplayName
	}
	if err := repository.UpdateCategory(cat, updates); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update category: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "updated"})
}

func (h *AdminHandler) DeleteCategory(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	cat, err := repository.FindCategoryByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "category not found"})
		return
	}

	repository.ReassignCategoryQuotes(cat.Name, "other")
	if err := repository.DeleteCategory(cat); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete category: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}
