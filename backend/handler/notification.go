package handler

import (
	"net/http"

	"hitokoto-server/backend/repository"

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

	total, _ := repository.CountNotifications(userID)
	unreadCount, _ := repository.CountUnreadNotifications(userID)

	offset := (page - 1) * pageSize
	notifications, _ := repository.ListNotifications(userID, offset, pageSize)

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

	notification, err := repository.FindNotificationByID(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "notification not found"})
		return
	}

	if notification.UserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "permission denied"})
		return
	}

	repository.MarkNotificationRead(notification)
	c.JSON(http.StatusOK, gin.H{"message": "marked as read"})
}

func (h *NotificationHandler) MarkAllRead(c *gin.Context) {
	userID := c.GetUint("user_id")

	repository.MarkAllNotificationsRead(userID)
	c.JSON(http.StatusOK, gin.H{"message": "all marked as read"})
}
