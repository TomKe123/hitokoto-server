package handler

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"hitokoto-server/backend/config"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"
	"hitokoto-server/backend/service"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/bcrypt"
)

type AdminHandler struct {
	Config *config.Config
}

var wsUpgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
}

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
		repository.SetQuoteCategories(quote.ID, []string{category})
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

	// Cannot change global admin bit through this endpoint — use GrantGlobalAdmin/RevokeGlobalAdmin instead
	input.Permissions &^= permissions.PermGlobalAdmin

	// Preserve existing GlobalAdmin bit (set separately via GrantGlobalAdmin/RevokeGlobalAdmin)
	finalPerms := input.Permissions | permissions.PermUpload | (target.Permissions & permissions.PermGlobalAdmin)

	if err := repository.UpdateUserField(target, "permissions", finalPerms); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update permissions: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "user permissions updated successfully"})
}

// GrantGlobalAdmin grants global admin permission to a user
func (h *AdminHandler) GrantGlobalAdmin(c *gin.Context) {
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

	target, err := repository.FindUserByID(uint(targetID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	newPerms := target.Permissions | permissions.PermGlobalAdmin
	if err := repository.UpdateUserField(target, "permissions", newPerms); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to grant global admin: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "global admin granted"})
}

// RevokeGlobalAdmin revokes global admin permission from a user
func (h *AdminHandler) RevokeGlobalAdmin(c *gin.Context) {
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

	target, err := repository.FindUserByID(uint(targetID))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	newPerms := target.Permissions &^ permissions.PermGlobalAdmin
	if err := repository.UpdateUserField(target, "permissions", newPerms); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke global admin: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "global admin revoked"})
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

func (h *AdminHandler) ListAllLists(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	lists, total, err := repository.GetAllListsPaginated(page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch lists: " + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"lists": lists, "total": total})
}

func (h *AdminHandler) AdminDeleteList(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list id"})
		return
	}

	list, err := repository.GetListByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return
	}

	if err := repository.DeleteListAsAdmin(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete list: " + err.Error()})
		return
	}

	// Notify the owner
	repository.CreateNotification(&model.Notification{
		UserID:    list.UserID,
		QuoteUUID: list.UUID,
		Type:      "list_deleted",
		Title:     "列表已被删除",
		Content:   "管理员删除了您的列表「" + list.Name + "」。",
	})

	c.JSON(http.StatusOK, gin.H{"message": "list deleted successfully"})
}

func (h *AdminHandler) BlockList(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list id"})
		return
	}

	list, err := repository.GetListByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return
	}

	if list.Blocked {
		c.JSON(http.StatusBadRequest, gin.H{"error": "list is already blocked"})
		return
	}

	var input struct {
		Reason string `json:"reason"`
	}
	c.ShouldBindJSON(&input)

	if err := repository.BlockList(uint(id), input.Reason); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to block list: " + err.Error()})
		return
	}

	// Notify the owner
	reasonText := ""
	if input.Reason != "" {
		reasonText = "，原因：" + input.Reason
	}
	repository.CreateNotification(&model.Notification{
		UserID:    list.UserID,
		QuoteUUID: list.UUID,
		Type:      "list_blocked",
		Title:     "列表已被屏蔽",
		Content:   "管理员屏蔽了您的列表「" + list.Name + "」" + reasonText + "。",
	})

	c.JSON(http.StatusOK, gin.H{"message": "list blocked successfully"})
}

func (h *AdminHandler) UnblockList(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid list id"})
		return
	}

	list, err := repository.GetListByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "list not found"})
		return
	}

	if !list.Blocked {
		c.JSON(http.StatusBadRequest, gin.H{"error": "list is not blocked"})
		return
	}

	if err := repository.UnblockList(uint(id)); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to unblock list: " + err.Error()})
		return
	}

	// Notify the owner
	repository.CreateNotification(&model.Notification{
		UserID:    list.UserID,
		QuoteUUID: list.UUID,
		Type:      "list_unblocked",
		Title:     "列表已解封",
		Content:   "管理员已解封您的列表「" + list.Name + "」。",
	})

	c.JSON(http.StatusOK, gin.H{"message": "list unblocked successfully"})
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
		if s.Key == "ai_api_key" {
			result[s.Key] = maskAPIKey(s.Value)
		} else {
			result[s.Key] = s.Value
		}
	}
	c.JSON(http.StatusOK, gin.H{"settings": result})
}

// maskAPIKey returns "***...xxxx" keeping only the last 4 characters visible.
func maskAPIKey(key string) string {
	if len(key) <= 4 {
		return "****"
	}
	return "****" + key[len(key)-4:]
}

func (h *AdminHandler) UpdateSetting(c *gin.Context) {
	var input struct {
		Key   string `json:"key" binding:"required"`
		Value string `json:"value"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// If the client sends back the masked placeholder for ai_api_key, ignore the update.
	if input.Key == "ai_api_key" && len(input.Value) > 0 && input.Value[:4] == "****" {
		c.JSON(http.StatusOK, gin.H{"message": "no change"})
		return
	}

	// Validate ai_rpm_limit range
	if input.Key == "ai_rpm_limit" {
		v, err := strconv.Atoi(input.Value)
		if err != nil || v < 1 || v > 30 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "ai_rpm_limit must be 1–30"})
			return
		}
	}

	// Validate ai_auto_approve_confidence value
	if input.Key == "ai_auto_approve_confidence" {
		switch input.Value {
		case "high", "medium", "low":
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "ai_auto_approve_confidence must be high, medium or low"})
			return
		}
	}

	// Validate ai_review_auto_apply_confidence value
	if input.Key == "ai_review_auto_apply_confidence" {
		switch input.Value {
		case "high", "medium", "low":
		default:
			c.JSON(http.StatusBadRequest, gin.H{"error": "ai_review_auto_apply_confidence must be high, medium or low"})
			return
		}
	}

	// Validate boolean-valued AI review settings
	switch input.Key {
	case "ai_review_enabled", "ai_review_auto_apply", "ai_review_auto_apply_reject":
		if input.Value != "true" && input.Value != "false" {
			c.JSON(http.StatusBadRequest, gin.H{"error": input.Key + " must be true or false"})
			return
		}
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

	// Return masked value for ai_api_key
	resp := gin.H{"setting": gin.H{"key": setting.Key, "value": setting.Value}}
	if setting.Key == "ai_api_key" {
		resp = gin.H{"setting": gin.H{"key": setting.Key, "value": maskAPIKey(setting.Value)}}
	}
	c.JSON(http.StatusOK, resp)
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

// ─── AI Classification ───────────────────────────────────────────────────────

// ListAISuggestions returns pending AI category suggestions (legacy).
func (h *AdminHandler) ListAISuggestions(c *gin.Context) {
	status := c.DefaultQuery("status", "pending")
	suggestions, err := repository.ListAISuggestions(status, 200)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to list suggestions: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"suggestions": suggestions})
}

// ApproveAISuggestion — legacy handler kept for backwards compatibility.
func (h *AdminHandler) ApproveAISuggestion(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	suggestion, err := repository.FindAISuggestionByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "suggestion not found"})
		return
	}
	if suggestion.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "suggestion is already " + suggestion.Status})
		return
	}
	existing, _ := repository.FindCategoryByName(suggestion.SuggestedName)
	if existing == nil {
		dn := suggestion.SuggestedDisplayName
		if dn == "" {
			dn = suggestion.SuggestedName
		}
		cat := model.Category{Name: suggestion.SuggestedName, DisplayName: dn}
		if err := repository.CreateCategory(&cat); err != nil {
			c.JSON(http.StatusConflict, gin.H{"error": "failed to create category: " + err.Error()})
			return
		}
	}
	if err := repository.UpdateQuote(suggestion.QuoteID, map[string]any{"category": suggestion.SuggestedName}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update quote: " + err.Error()})
		return
	}
	_ = repository.UpdateAISuggestionStatus(suggestion, "approved")
	c.JSON(http.StatusOK, gin.H{"message": "approved", "category": suggestion.SuggestedName})
}

// RejectAISuggestion — legacy handler kept for backwards compatibility.
func (h *AdminHandler) RejectAISuggestion(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	suggestion, err := repository.FindAISuggestionByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "suggestion not found"})
		return
	}
	if suggestion.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "suggestion is already " + suggestion.Status})
		return
	}
	_ = repository.UpdateAISuggestionStatus(suggestion, "rejected")
	c.JSON(http.StatusOK, gin.H{"message": "rejected"})
}

// TriggerAIClassify manually triggers AI classification for a single quote.
func (h *AdminHandler) TriggerAIClassify(c *gin.Context) {
	id := c.Param("id")
	quote, err := repository.FindQuoteByUUIDOrID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "quote not found"})
		return
	}
	go service.ClassifyQuoteAsync(*quote)
	c.JSON(http.StatusAccepted, gin.H{"message": "classification triggered"})
}

// GetBatchStatus returns the current batch job status (for reconnecting clients).
func (h *AdminHandler) GetBatchStatus(c *gin.Context) {
	c.JSON(http.StatusOK, service.GetBatchStatus())
}

// PreviewBatchClassifyCount returns how many quotes match the given filter,
// so the UI can show the size of the subset before starting a run.
func (h *AdminHandler) PreviewBatchClassifyCount(c *gin.Context) {
	var input struct {
		Status           string   `json:"status"`
		Categories       []string `json:"categories"`
		Search           []string `json:"search"`
		OnlyUnclassified bool     `json:"only_unclassified"`
	}
	_ = c.ShouldBindJSON(&input)

	filter := repository.QuoteBatchFilter{
		Status:           input.Status,
		Categories:       input.Categories,
		Search:           input.Search,
		OnlyUnclassified: input.OnlyUnclassified,
	}
	count, err := repository.CountQuotesFiltered(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

// PauseBatchClassify pauses the running batch job.
func (h *AdminHandler) PauseBatchClassify(c *gin.Context) {
	if err := service.PauseBatchClassify(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "paused"})
}

// ResumeBatchClassify resumes a paused batch job.
func (h *AdminHandler) ResumeBatchClassify(c *gin.Context) {
	if err := service.ResumeBatchClassify(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "resumed"})
}

// ─── AIClassifyChange review handlers ────────────────────────────────────────

// ListAIChanges returns AI classify changes with optional filters.
func (h *AdminHandler) ListAIChanges(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	changes, total, err := repository.ListAIChanges(repository.AIChangeFilter{
		Status:   c.Query("status"),
		BatchRun: c.Query("batch_run"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Parse suggestions JSON for each change so the frontend gets structured data
	type changeResp struct {
		model.AIClassifyChange
		SuggestionsParsed []service.SuggestionItem `json:"suggestions_list"`
	}
	result := make([]changeResp, 0, len(changes))
	for _, ch := range changes {
		var items []service.SuggestionItem
		_ = json.Unmarshal([]byte(ch.Suggestions), &items)
		result = append(result, changeResp{AIClassifyChange: ch, SuggestionsParsed: items})
	}

	c.JSON(http.StatusOK, gin.H{
		"changes":     result,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// ApproveAIChange approves a change, appending one OR MORE categories to the
// quote's category set (a quote may belong to several categories). It creates
// any category that doesn't exist yet.
//
// Accepted request bodies (in priority order):
//  1. {"categories":[{"name":"anime","display_name":"动画"}, ...]} — multi-select
//  2. {"category_name":"anime","category_display_name":"动画"}     — single override (legacy)
//  3. empty body — applies the change's primary suggestion (NewCategory)
func (h *AdminHandler) ApproveAIChange(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var input struct {
		CategoryName        string `json:"category_name"`
		CategoryDisplayName string `json:"category_display_name"`
		Categories          []struct {
			Name        string `json:"name"`
			DisplayName string `json:"display_name"`
		} `json:"categories"`
	}
	_ = c.ShouldBindJSON(&input)

	ch, err := repository.FindAIChangeByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change not found"})
		return
	}
	if ch.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "change is already " + ch.Status})
		return
	}

	// display_name lookup from the stored suggestions (used when the caller
	// didn't supply one).
	var items []service.SuggestionItem
	_ = json.Unmarshal([]byte(ch.Suggestions), &items)
	displayFor := func(name string) string {
		for _, s := range items {
			if s.Name == name {
				return s.DisplayName
			}
		}
		return ""
	}

	// Build the ordered, de-duplicated set of categories to apply.
	type catInput struct{ name, display string }
	seen := make(map[string]bool)
	var targets []catInput
	add := func(name, display string) {
		name = strings.ToLower(strings.TrimSpace(name))
		if name == "" || seen[name] {
			return
		}
		seen[name] = true
		if strings.TrimSpace(display) == "" {
			display = displayFor(name)
		}
		targets = append(targets, catInput{name, strings.TrimSpace(display)})
	}

	switch {
	case len(input.Categories) > 0:
		for _, cc := range input.Categories {
			add(cc.Name, cc.DisplayName)
		}
	case input.CategoryName != "":
		add(input.CategoryName, input.CategoryDisplayName)
	default:
		add(ch.NewCategory, "")
	}

	if len(targets) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no category selected"})
		return
	}

	applied := make([]string, 0, len(targets))
	for _, t := range targets {
		// Create the category if it doesn't exist yet.
		if existing, _ := repository.FindCategoryByName(t.name); existing == nil {
			dn := t.display
			if dn == "" {
				dn = t.name
			}
			cat := model.Category{Name: t.name, DisplayName: dn}
			if err := repository.CreateCategory(&cat); err != nil {
				c.JSON(http.StatusConflict, gin.H{"error": "failed to create category: " + err.Error()})
				return
			}
		}
		// Append to the quote's category set (multi-category, deduplicated).
		if err := repository.AddQuoteCategory(ch.QuoteID, t.name); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update quote: " + err.Error()})
			return
		}
		applied = append(applied, t.name)
	}

	_ = repository.UpdateAIChangeStatus(ch, "approved")
	c.JSON(http.StatusOK, gin.H{"message": "approved", "category": strings.Join(applied, "、"), "categories": applied})
}

// RejectAIChange rejects a pending change without modifying the quote.
func (h *AdminHandler) RejectAIChange(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	ch, err := repository.FindAIChangeByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change not found"})
		return
	}
	if ch.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "change is already " + ch.Status})
		return
	}
	_ = repository.UpdateAIChangeStatus(ch, "rejected")
	c.JSON(http.StatusOK, gin.H{"message": "rejected"})
}

// ReclassifyAIChange re-runs the AI on a pending change's quote and updates the
// change's suggestions in place, returning the refreshed record.
func (h *AdminHandler) ReclassifyAIChange(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	change, err := service.ReclassifyForChange(uint(id))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var items []service.SuggestionItem
	_ = json.Unmarshal([]byte(change.Suggestions), &items)
	type changeResp struct {
		model.AIClassifyChange
		SuggestionsParsed []service.SuggestionItem `json:"suggestions_list"`
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "reclassified",
		"change":  changeResp{AIClassifyChange: *change, SuggestionsParsed: items},
	})
}

// BulkReviewAIChanges approves or rejects multiple pending changes at once.
func (h *AdminHandler) BulkReviewAIChanges(c *gin.Context) {
	var input struct {
		IDs    []uint `json:"ids" binding:"required,min=1"`
		Action string `json:"action" binding:"required"` // approve / reject
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Action != "approve" && input.Action != "reject" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action must be approve or reject"})
		return
	}

	if input.Action == "reject" {
		affected, err := repository.BulkUpdateAIChangeStatus(input.IDs, "rejected")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"affected": affected})
		return
	}

	// Approve: process one by one (need to create categories + update quotes)
	var approved, failed int
	for _, id := range input.IDs {
		ch, err := repository.FindAIChangeByID(id)
		if err != nil || ch.Status != "pending" {
			continue
		}
		catName := ch.NewCategory
		if existing, _ := repository.FindCategoryByName(catName); existing == nil {
			var items []service.SuggestionItem
			dn := catName
			if json.Unmarshal([]byte(ch.Suggestions), &items) == nil {
				for _, s := range items {
					if s.Name == catName && s.DisplayName != "" {
						dn = s.DisplayName
						break
					}
				}
			}
			cat := model.Category{Name: catName, DisplayName: dn}
			if err := repository.CreateCategory(&cat); err != nil {
				failed++
				continue
			}
		}
		if err := repository.AddQuoteCategory(ch.QuoteID, catName); err != nil {
			failed++
			continue
		}
		_ = repository.UpdateAIChangeStatus(ch, "approved")
		approved++
	}

	c.JSON(http.StatusOK, gin.H{"approved": approved, "failed": failed})
}

// ApproveAllByConfidence approves every pending change whose suggestions meet a
// confidence threshold, applying all qualifying suggestions per quote. The
// threshold is inclusive of higher tiers (low → low/medium/high).
func (h *AdminHandler) ApproveAllByConfidence(c *gin.Context) {
	var input struct {
		Confidence string `json:"confidence" binding:"required"` // high / medium / low
		BatchRun   string `json:"batch_run"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	minRank := service.ConfidenceRank(input.Confidence)
	if minRank == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "confidence must be high, medium or low"})
		return
	}

	changes, err := repository.GetAllPendingAIChanges(input.BatchRun)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var approved, skipped, failed int
	for i := range changes {
		ch := &changes[i]
		applied, err := service.ApplyChangeByConfidence(ch.QuoteID, ch.Suggestions, minRank)
		if err != nil {
			failed++
			continue
		}
		if len(applied) == 0 {
			// No suggestion met the threshold — leave it pending for manual review.
			skipped++
			continue
		}
		_ = repository.UpdateAIChangeStatus(ch, "approved")
		approved++
	}

	c.JSON(http.StatusOK, gin.H{"approved": approved, "skipped": skipped, "failed": failed})
}

// GetAIChangeCounts returns status counts for a batch run (for the summary header).
func (h *AdminHandler) GetAIChangeCounts(c *gin.Context) {
	batchRun := c.Query("batch_run")
	counts := repository.CountAIChangesByStatus(batchRun)
	c.JSON(http.StatusOK, gin.H{"counts": counts})
}

// ListAIModels fetches the model list from the configured AI provider.
func (h *AdminHandler) ListAIModels(c *gin.Context) {
	var input struct {
		APIKey  string `json:"api_key"`
		BaseURL string `json:"base_url"`
	}
	// Accept params from JSON body or query string for convenience
	_ = c.ShouldBindJSON(&input)
	if input.APIKey == "" {
		input.APIKey = c.Query("api_key")
	}
	if input.BaseURL == "" {
		input.BaseURL = c.Query("base_url")
	}

	// Fall back to stored settings if not provided in request
	if input.APIKey == "" || strings.HasPrefix(input.APIKey, "****") {
		if s, _ := repository.FindSettingByKey("ai_api_key"); s != nil {
			input.APIKey = s.Value
		}
	}
	if input.BaseURL == "" {
		if s, _ := repository.FindSettingByKey("ai_base_url"); s != nil {
			input.BaseURL = s.Value
		}
	}

	if input.APIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "服务商无相关功能或 API 密钥错误"})
		return
	}

	models, err := service.FetchModels(input.APIKey, input.BaseURL)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"models": models})
}

// TestAIConnection sends a minimal "hi" prompt and returns latency + reply.
func (h *AdminHandler) TestAIConnection(c *gin.Context) {
	var input struct {
		APIKey  string `json:"api_key"`
		BaseURL string `json:"base_url"`
		Model   string `json:"model"`
	}
	_ = c.ShouldBindJSON(&input)

	// Fall back to stored settings for any missing field
	if input.APIKey == "" || strings.HasPrefix(input.APIKey, "****") {
		if s, _ := repository.FindSettingByKey("ai_api_key"); s != nil {
			input.APIKey = s.Value
		}
	}
	if input.BaseURL == "" {
		if s, _ := repository.FindSettingByKey("ai_base_url"); s != nil {
			input.BaseURL = s.Value
		}
	}
	if input.Model == "" {
		if s, _ := repository.FindSettingByKey("ai_model"); s != nil && s.Value != "" {
			input.Model = s.Value
		} else {
			input.Model = "gpt-4o-mini"
		}
	}

	if input.APIKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "未配置 API Key"})
		return
	}

	reply, latencyMs, err := service.TestConnection(input.APIKey, input.BaseURL, input.Model)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"reply":      reply,
		"latency_ms": latencyMs,
	})
}

// ─── Batch classify WebSocket ─────────────────────────────────────────────────

// BatchClassifyWS handles a WebSocket connection for batch AI classification.
// The route is registered outside the auth-middleware group so the WS upgrade
// can succeed; JWT is validated here via the ?token= query param.
//
// Client → server: {"action":"start"} | {"action":"stop"}
// Server → client: BatchMsg JSON (type: start/log/done/stopped/error)
func (h *AdminHandler) BatchClassifyWS(c *gin.Context) {
	// Validate JWT from query param (browsers cannot set headers on WS)
	tokenStr := c.Query("token")
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}
	mapClaims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(tokenStr, mapClaims, func(t *jwt.Token) (any, error) {
		return []byte(h.Config.JWTSecret), nil
	})
	if err != nil || !tok.Valid {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	role, _ := mapClaims["role"].(string)
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// clientDone is closed when the read pump exits (connection closed).
	clientDone := make(chan struct{})
	startCh := make(chan repository.QuoteBatchFilter, 1)
	stopCh := make(chan struct{}, 1)

	go func() {
		defer close(clientDone)
		for {
			var msg struct {
				Action string `json:"action"`
				Filter struct {
					Status           string   `json:"status"`
					Categories       []string `json:"categories"`
					Search           []string `json:"search"`
					OnlyUnclassified bool     `json:"only_unclassified"`
				} `json:"filter"`
			}
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			switch msg.Action {
			case "start":
				filter := repository.QuoteBatchFilter{
					Status:           msg.Filter.Status,
					Categories:       msg.Filter.Categories,
					Search:           msg.Filter.Search,
					OnlyUnclassified: msg.Filter.OnlyUnclassified,
				}
				select {
				case startCh <- filter:
				default:
				}
			case "stop":
				select {
				case stopCh <- struct{}{}:
				default:
				}
			}
		}
	}()

	writeMsg := func(v any) bool {
		conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
		err := conn.WriteJSON(v)
		conn.SetWriteDeadline(time.Time{})
		return err == nil
	}

	// streamJob drains a message channel until it closes or the client disconnects.
	streamJob := func(msgCh <-chan service.BatchMsg, subID int) {
		defer service.UnsubscribeBatch(subID)
		for {
			select {
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				if !writeMsg(msg) {
					return
				}
			case <-stopCh:
				service.StopBatchClassify()
			case <-clientDone:
				return
			}
		}
	}

	// If a job is already running, subscribe to it immediately.
	if subID, msgCh, _ := service.SubscribeBatch(); msgCh != nil {
		streamJob(msgCh, subID)
		// After the job finishes, fall through to wait for next start.
	}

	// Wait for the client to request a new job.
	for {
		select {
		case <-clientDone:
			return
		case <-stopCh:
			service.StopBatchClassify()
		case filter := <-startCh:
			if err := service.StartBatchClassifyFiltered(filter); err != nil {
				writeMsg(service.BatchMsg{Type: "error", Message: err.Error()})
				continue
			}
			subID, msgCh, _ := service.SubscribeBatch()
			if msgCh == nil {
				writeMsg(service.BatchMsg{Type: "error", Message: "无法订阅任务"})
				continue
			}
			streamJob(msgCh, subID)
		}
	}
}

// ─── AIReviewChange handlers ──────────────────────────────────────────────────

// ListAIReviewChanges returns AI review changes with optional filters.
func (h *AdminHandler) ListAIReviewChanges(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	changes, total, err := repository.ListAIReviewChanges(repository.AIReviewChangeFilter{
		Status:   c.Query("status"),
		BatchRun: c.Query("batch_run"),
		Page:     page,
		PageSize: pageSize,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"changes":     changes,
		"total":       total,
		"page":        page,
		"page_size":   pageSize,
		"total_pages": (int(total) + pageSize - 1) / pageSize,
	})
}

// GetAIReviewChangeCounts returns status counts for a batch run.
func (h *AdminHandler) GetAIReviewChangeCounts(c *gin.Context) {
	batchRun := c.Query("batch_run")
	counts := repository.CountAIReviewChangesByStatus(batchRun)
	c.JSON(http.StatusOK, gin.H{"counts": counts})
}

// applyReviewChange adopts a review change's AI verdict: it sets the quote status
// to approved or rejected (per the verdict), notifying the contributor on
// rejection, then marks the change "approved". Returns the status applied.
func applyReviewChange(ch *model.AIReviewChange) (string, error) {
	status := "approved"
	if !ch.Approved {
		status = "rejected"
	}
	if err := repository.UpdateQuoteStatus(ch.QuoteID, status); err != nil {
		return "", err
	}
	if status == "rejected" {
		if quote, err := repository.FindQuoteByID(ch.QuoteID); err == nil && quote != nil {
			content := "您的语录「" + truncateText(quote.Content, 50) + "」未通过审核。"
			if strings.TrimSpace(ch.Reason) != "" {
				content += "原因：" + ch.Reason
			}
			createNotification(quote.ContributorID, quote.UUID, "rejected", "语录未通过审核", content)
		}
	}
	_ = repository.UpdateAIReviewChangeStatus(ch, "approved")
	return status, nil
}

// ApproveAIReviewChange adopts the AI verdict for a single pending review change,
// applying it to the quote status (approved or rejected per the verdict).
func (h *AdminHandler) ApproveAIReviewChange(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	ch, err := repository.FindAIReviewChangeByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change not found"})
		return
	}
	if ch.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "change is already " + ch.Status})
		return
	}
	status, err := applyReviewChange(ch)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to apply review: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "applied", "quote_status": status})
}

// RejectAIReviewChange dismisses the AI verdict without changing the quote.
func (h *AdminHandler) RejectAIReviewChange(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	ch, err := repository.FindAIReviewChangeByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "change not found"})
		return
	}
	if ch.Status != "pending" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "change is already " + ch.Status})
		return
	}
	_ = repository.UpdateAIReviewChangeStatus(ch, "rejected")
	c.JSON(http.StatusOK, gin.H{"message": "dismissed"})
}

// PLACEHOLDER_REVIEW_HANDLERS

// BulkReviewAIReviewChanges adopts (apply) or dismisses (dismiss) multiple
// pending review changes at once. "apply" sets each quote's status per its AI
// verdict; "dismiss" marks the changes rejected without touching the quotes.
func (h *AdminHandler) BulkReviewAIReviewChanges(c *gin.Context) {
	var input struct {
		IDs    []uint `json:"ids" binding:"required,min=1"`
		Action string `json:"action" binding:"required"` // apply / dismiss
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if input.Action != "apply" && input.Action != "dismiss" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "action must be apply or dismiss"})
		return
	}

	if input.Action == "dismiss" {
		affected, err := repository.BulkUpdateAIReviewChangeStatus(input.IDs, "rejected")
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"affected": affected})
		return
	}

	// Apply: process one by one (each updates a quote + the change).
	var applied, failed int
	for _, id := range input.IDs {
		ch, err := repository.FindAIReviewChangeByID(id)
		if err != nil || ch.Status != "pending" {
			continue
		}
		if _, err := applyReviewChange(ch); err != nil {
			failed++
			continue
		}
		applied++
	}
	c.JSON(http.StatusOK, gin.H{"applied": applied, "failed": failed})
}

// ApproveAllReviewByConfidence applies every pending review decision whose
// confidence meets a threshold. Reject verdicts are only applied when
// allow_reject is true; otherwise they are left pending for manual review.
func (h *AdminHandler) ApproveAllReviewByConfidence(c *gin.Context) {
	var input struct {
		Confidence  string `json:"confidence" binding:"required"` // high / medium / low
		BatchRun    string `json:"batch_run"`
		AllowReject bool   `json:"allow_reject"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	minRank := service.ConfidenceRank(input.Confidence)
	if minRank == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "confidence must be high, medium or low"})
		return
	}

	changes, err := repository.GetAllPendingAIReviewChanges(input.BatchRun)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var applied, skipped, failed int
	for i := range changes {
		ch := &changes[i]
		status, err := service.ApplyReviewByConfidence(ch.ID, minRank, input.AllowReject)
		if err != nil {
			failed++
			continue
		}
		if status == "" {
			// Below threshold, or a reject verdict while allow_reject is false.
			skipped++
			continue
		}
		_ = repository.UpdateAIReviewChangeStatus(ch, "approved")
		applied++
	}

	c.JSON(http.StatusOK, gin.H{"applied": applied, "skipped": skipped, "failed": failed})
}

// ─── Review batch control handlers ────────────────────────────────────────────

// PreviewBatchReviewCount returns how many quotes match the given filter, so the
// UI can show the size of the subset before starting a review run.
func (h *AdminHandler) PreviewBatchReviewCount(c *gin.Context) {
	var input struct {
		Status         string   `json:"status"`
		Categories     []string `json:"categories"`
		Search         []string `json:"search"`
		OnlyUnreviewed bool     `json:"only_unreviewed"`
	}
	_ = c.ShouldBindJSON(&input)

	filter := repository.QuoteBatchFilter{
		Status:         input.Status,
		Categories:     input.Categories,
		Search:         input.Search,
		OnlyUnreviewed: input.OnlyUnreviewed,
	}
	count, err := repository.CountQuotesFiltered(filter)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"count": count})
}

func (h *AdminHandler) GetReviewBatchStatus(c *gin.Context) {
	c.JSON(http.StatusOK, service.GetReviewBatchStatus())
}

func (h *AdminHandler) PauseBatchReview(c *gin.Context) {
	if err := service.PauseBatchReview(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "paused"})
}

func (h *AdminHandler) ResumeBatchReview(c *gin.Context) {
	if err := service.ResumeBatchReview(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "resumed"})
}

// ReviewBatchWS streams batch AI review progress over a WebSocket. JWT is
// validated from the query param (browsers cannot set WS headers).
func (h *AdminHandler) ReviewBatchWS(c *gin.Context) {
	tokenStr := c.Query("token")
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "missing token"})
		return
	}
	mapClaims := jwt.MapClaims{}
	tok, err := jwt.ParseWithClaims(tokenStr, mapClaims, func(t *jwt.Token) (any, error) {
		return []byte(h.Config.JWTSecret), nil
	})
	if err != nil || !tok.Valid {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}
	if role, _ := mapClaims["role"].(string); role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return
	}

	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	clientDone := make(chan struct{})
	startCh := make(chan repository.QuoteBatchFilter, 1)
	stopCh := make(chan struct{}, 1)

	go func() {
		defer close(clientDone)
		for {
			var msg struct {
				Action string `json:"action"`
				Filter struct {
					Status         string   `json:"status"`
					Categories     []string `json:"categories"`
					Search         []string `json:"search"`
					OnlyUnreviewed bool     `json:"only_unreviewed"`
				} `json:"filter"`
			}
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			switch msg.Action {
			case "start":
				filter := repository.QuoteBatchFilter{
					Status:         msg.Filter.Status,
					Categories:     msg.Filter.Categories,
					Search:         msg.Filter.Search,
					OnlyUnreviewed: msg.Filter.OnlyUnreviewed,
				}
				select {
				case startCh <- filter:
				default:
				}
			case "stop":
				select {
				case stopCh <- struct{}{}:
				default:
				}
			}
		}
	}()

	writeMsg := func(v any) bool {
		conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
		err := conn.WriteJSON(v)
		conn.SetWriteDeadline(time.Time{})
		return err == nil
	}

	streamJob := func(msgCh <-chan service.ReviewBatchMsg, subID int) {
		defer service.UnsubscribeReviewBatch(subID)
		for {
			select {
			case msg, ok := <-msgCh:
				if !ok {
					return
				}
				if !writeMsg(msg) {
					return
				}
			case <-stopCh:
				service.StopBatchReview()
			case <-clientDone:
				return
			}
		}
	}

	// If a job is already running, subscribe to it immediately.
	if subID, msgCh, _ := service.SubscribeReviewBatch(); msgCh != nil {
		streamJob(msgCh, subID)
	}

	for {
		select {
		case <-clientDone:
			return
		case <-stopCh:
			service.StopBatchReview()
		case filter := <-startCh:
			if err := service.StartBatchReviewFiltered(filter); err != nil {
				writeMsg(service.ReviewBatchMsg{Type: "error", Message: err.Error()})
				continue
			}
			subID, msgCh, _ := service.SubscribeReviewBatch()
			if msgCh == nil {
				writeMsg(service.ReviewBatchMsg{Type: "error", Message: "无法订阅任务"})
				continue
			}
			streamJob(msgCh, subID)
		}
	}
}


