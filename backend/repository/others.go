package repository

import (
	"time"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
)

// --- Notification CRUD ---

func CreateNotification(n *model.Notification) error {
	return database.DB.Create(n).Error
}

func CountNotifications(userID uint) (int64, error) {
	var total int64
	err := database.DB.Model(&model.Notification{}).Where("user_id = ?", userID).Count(&total).Error
	return total, err
}

func CountUnreadNotifications(userID uint) (int64, error) {
	var count int64
	err := database.DB.Model(&model.Notification{}).Where("user_id = ? AND is_read = ?", userID, false).Count(&count).Error
	return count, err
}

func ListNotifications(userID uint, offset, limit int) ([]model.Notification, error) {
	var list []model.Notification
	err := database.DB.Where("user_id = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&list).Error
	return list, err
}

func FindNotificationByID(id interface{}) (*model.Notification, error) {
	var n model.Notification
	err := database.DB.First(&n, id).Error
	if err != nil {
		return nil, err
	}
	return &n, nil
}

func MarkNotificationRead(n *model.Notification) error {
	return database.DB.Model(n).Update("is_read", true).Error
}

func MarkAllNotificationsRead(userID uint) error {
	return database.DB.Model(&model.Notification{}).
		Where("user_id = ? AND is_read = ?", userID, false).
		Update("is_read", true).Error
}

// --- SeenQuote ---

func CreateSeenQuote(sq *model.SeenQuote) error {
	return database.DB.Create(sq).Error
}

func FindSeenQuotesByToken(token string) ([]model.SeenQuote, error) {
	var records []model.SeenQuote
	err := database.DB.Where("token = ?", token).Find(&records).Error
	return records, err
}

func DeleteExpiredSeenQuotes() {
	database.DB.Where("created_at < ?", time.Now().Add(-24*time.Hour)).Delete(&model.SeenQuote{})
}

// --- RefreshToken ---

func CreateRefreshToken(rt *model.RefreshToken) error {
	return database.DB.Create(rt).Error
}

func FindRefreshToken(token string, userID uint) (*model.RefreshToken, error) {
	var rt model.RefreshToken
	err := database.DB.Where("token = ? AND user_id = ?", token, userID).First(&rt).Error
	if err != nil {
		return nil, err
	}
	return &rt, nil
}

func DeleteRefreshToken(rt *model.RefreshToken) error {
	return database.DB.Delete(rt).Error
}

func DeleteRefreshTokenByUserAndToken(userID uint, token string) error {
	return database.DB.Where("token = ? AND user_id = ?", token, userID).Delete(&model.RefreshToken{}).Error
}

// --- Setting ---

func ListSettings() ([]model.Setting, error) {
	var settings []model.Setting
	err := database.DB.Find(&settings).Error
	return settings, err
}

func FindSettingByKey(key string) (*model.Setting, error) {
	var settings []model.Setting
	if err := database.DB.Where("`key` = ?", key).Limit(1).Find(&settings).Error; err != nil {
		return nil, err
	}
	if len(settings) == 0 {
		return nil, nil
	}
	return &settings[0], nil
}

func CreateSetting(s *model.Setting) error {
	return database.DB.Create(s).Error
}

func UpdateSettingValue(s *model.Setting, value string) error {
	return database.DB.Model(s).Update("value", value).Error
}

func ReloadSetting(s *model.Setting) error {
	return database.DB.First(s, s.ID).Error
}
