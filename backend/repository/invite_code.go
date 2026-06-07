package repository

import (
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"

	"gorm.io/gorm"
)

// --- InviteCode CRUD ---

func FindInviteCodeByCode(code string) (*model.InviteCode, error) {
	var ic model.InviteCode
	err := database.DB.Where("code = ?", code).First(&ic).Error
	if err != nil {
		return nil, err
	}
	return &ic, nil
}

func CreateInviteCode(ic *model.InviteCode) error {
	return database.DB.Create(ic).Error
}

func IncrementInviteCodeUsage(ic *model.InviteCode) error {
	return database.DB.Model(ic).Update("use_count", ic.UseCount+1).Error
}

func ListInviteCodes() ([]model.InviteCode, error) {
	var codes []model.InviteCode
	err := database.DB.Order("created_at DESC").Find(&codes).Error
	return codes, err
}

func DeleteInviteCodeByID(id uint) (int64, error) {
	result := database.DB.Delete(&model.InviteCode{}, id)
	return result.RowsAffected, result.Error
}

func FindInviteCodeByID(id uint) (*model.InviteCode, error) {
	var ic model.InviteCode
	err := database.DB.First(&ic, id).Error
	if err != nil {
		return nil, err
	}
	return &ic, nil
}

func UpdateInviteCode(ic *model.InviteCode, updates map[string]interface{}) error {
	return database.DB.Model(ic).Updates(updates).Error
}

func ListUserInviteCodes(userID uint, offset, limit int) ([]model.InviteCode, error) {
	var codes []model.InviteCode
	err := database.DB.Where("created_by = ?", userID).
		Order("created_at DESC").
		Offset(offset).Limit(limit).
		Find(&codes).Error
	return codes, err
}

func CountUserInviteCodes(userID uint) (int64, error) {
	var total int64
	err := database.DB.Model(&model.InviteCode{}).Where("created_by = ?", userID).Count(&total).Error
	return total, err
}

// InviteCodesByUserQuery returns a query scoped to a user, for paginated list + count.
func InviteCodesByUserQuery(userID uint) *gorm.DB {
	return database.DB.Model(&model.InviteCode{}).Where("created_by = ?", userID)
}
