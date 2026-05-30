package handler

import (
	"net/http"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"github.com/gin-gonic/gin"
)

type NotificationHandler struct{}

func (h *NotificationHandler) List(c *gin.Context) {
	userID := c.GetUint("user_id")
	page := 1
	pageSize := 20

	if p, err := parseInt(c.Query("page"), 1); err == nil {
		page = p
	}
	if ps, err := parseInt(c.Query("page_size"), 20); err == nil {
		pageSize = ps
		if pageSize > 100 {
			pageSize = 100
		}
	}

	var total int64
	database.DB.Model(&model.Notification{}).Where("user_id = ?", userID).Count(&total)

	var unreadCount int64
	database.DB.Model(&model.Notification{}).Where("user_id = ? AND is_read = ?", userID, false).Count(&unreadCount)

	var notifications []model.Notification
	offset := (page - 1) * pageSize
	database.DB.Where("user_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(pageSize).
		Find(&notifications)

	c.JSON(http.StatusOK, gin.H{
		"notifications": notifications,
		"total":         total,
		"page":          page,
		"page_size":     pageSize,
		"total_pages":   (int(total) + pageSize - 1) / pageSize,
		"unread_count":  unreadCount,
	})
}

func (h *NotificationHandler) MarkRead(c *gin.Context) {
	userID := c.GetUint("user_id")
	id := c.Param("id")

	var notification model.Notification
	if err := database.DB.First(&notification, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}

	if notification.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	database.DB.Model(&notification).Update("is_read", true)
	c.JSON(http.StatusOK, gin.H{"message": "marked as read"})
}

func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	userID := c.GetUint("user_id")

	database.DB.Model(&model.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Update("is_read", true)

	c.JSON(http.StatusOK, gin.H{"message": "all marked as read"})
}
