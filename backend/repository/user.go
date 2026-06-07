package repository

import (
	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"

	"gorm.io/gorm"
)

// --- User CRUD ---

func CreateUser(u *model.User) error {
	return database.DB.Create(u).Error
}

func FindUserByID(id interface{}) (*model.User, error) {
	var u model.User
	err := database.DB.First(&u, id).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func FindUserByUsername(username string) (*model.User, error) {
	var u model.User
	err := database.DB.Where("username = ?", username).First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func FindUserByEmail(email string) (*model.User, error) {
	var u model.User
	err := database.DB.Where("email = ?", email).First(&u).Error
	if err != nil {
		return nil, err
	}
	return &u, nil
}

func UsernameExistsExcluding(username string, excludeID uint) (bool, error) {
	var u model.User
	err := database.DB.Where("username = ? AND id != ?", username, excludeID).First(&u).Error
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	return err == nil, err
}

func EmailExistsExcluding(email string, excludeID uint) (bool, error) {
	var u model.User
	err := database.DB.Where("email = ? AND id != ?", email, excludeID).First(&u).Error
	if err == gorm.ErrRecordNotFound {
		return false, nil
	}
	return err == nil, err
}

func UpdateUserByID(id interface{}, updates map[string]interface{}) error {
	return database.DB.Model(&model.User{}).Where("id = ?", id).Updates(updates).Error
}

func UpdateUserField(u *model.User, field string, value interface{}) error {
	return database.DB.Model(u).Update(field, value).Error
}

func CountAdmins() (int64, error) {
	var count int64
	err := database.DB.Model(&model.User{}).Where("role = ?", "admin").Count(&count).Error
	return count, err
}

// UsersQuery returns a base query for listing users.
func UsersQuery() *gorm.DB {
	return database.DB.Model(&model.User{})
}

func FindUsersByIDs(ids []uint) ([]struct {
	ID       uint
	Username string
}, error) {
	var users []struct {
		ID       uint
		Username string
	}
	err := database.DB.Model(&model.User{}).Where("id IN ?", ids).Find(&users).Error
	return users, err
}

// --- User repairs ---

func GrantDefaultPermissions() int64 {
	result := database.DB.Model(&model.User{}).
		Where("status != ? AND permissions = ?", "banned", 0).
		Update("permissions", permissions.PermUpload)
	return result.RowsAffected
}

func FixAdminPermissions() int64 {
	result := database.DB.Model(&model.User{}).
		Where("role = ? AND permissions != ?", "admin", permissions.PermAll).
		Update("permissions", permissions.PermAll)
	return result.RowsAffected
}
