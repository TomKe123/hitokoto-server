package repository

import (
	"hitokoto-server/backend/model"
	"time"

	"gorm.io/gorm"
)

type OrganizationInviteRepository struct {
	db *gorm.DB
}

func NewOrganizationInviteRepository(db *gorm.DB) *OrganizationInviteRepository {
	return &OrganizationInviteRepository{db: db}
}

func (r *OrganizationInviteRepository) Create(invite *model.OrganizationInvite) error {
	return r.db.Create(invite).Error
}

func (r *OrganizationInviteRepository) GetByID(id uint) (*model.OrganizationInvite, error) {
	var invite model.OrganizationInvite
	err := r.db.First(&invite, id).Error
	if err != nil {
		return nil, err
	}
	return &invite, nil
}

func (r *OrganizationInviteRepository) GetByCode(code string) (*model.OrganizationInvite, error) {
	var invite model.OrganizationInvite
	err := r.db.Where("code = ?", code).First(&invite).Error
	if err != nil {
		return nil, err
	}
	return &invite, nil
}

func (r *OrganizationInviteRepository) ListByOrgID(orgID uint) ([]model.OrganizationInvite, error) {
	var invites []model.OrganizationInvite
	err := r.db.Where("organization_id = ?", orgID).Find(&invites).Error
	return invites, err
}

func (r *OrganizationInviteRepository) ListByTargetUserID(userID uint) ([]model.OrganizationInvite, error) {
	var invites []model.OrganizationInvite
	err := r.db.Where("target_user_id = ?", userID).Find(&invites).Error
	return invites, err
}

func (r *OrganizationInviteRepository) Update(invite *model.OrganizationInvite) error {
	return r.db.Save(invite).Error
}

func (r *OrganizationInviteRepository) Delete(id uint) error {
	return r.db.Delete(&model.OrganizationInvite{}, id).Error
}

func (r *OrganizationInviteRepository) IncrementUseCount(id uint) error {
	return r.db.Model(&model.OrganizationInvite{}).Where("id = ?", id).UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error
}

func (r *OrganizationInviteRepository) IsValid(code string) bool {
	invite, err := r.GetByCode(code)
	if err != nil {
		return false
	}

	// Check if expired
	if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
		return false
	}

	// Check if max uses reached
	if invite.UseCount >= invite.MaxUses {
		return false
	}

	return true
}

func (r *OrganizationInviteRepository) DeleteExpired() error {
	return r.db.Where("expires_at < ?", time.Now()).Delete(&model.OrganizationInvite{}).Error
}