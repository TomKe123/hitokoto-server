package repository

import (
	"hitokoto-server/backend/model"

	"gorm.io/gorm"
)

type OrganizationMemberRepository struct {
	db *gorm.DB
}

func NewOrganizationMemberRepository(db *gorm.DB) *OrganizationMemberRepository {
	return &OrganizationMemberRepository{db: db}
}

func (r *OrganizationMemberRepository) Create(member *model.OrganizationMember) error {
	return r.db.Create(member).Error
}

func (r *OrganizationMemberRepository) GetByID(id uint) (*model.OrganizationMember, error) {
	var member model.OrganizationMember
	err := r.db.First(&member, id).Error
	if err != nil {
		return nil, err
	}
	return &member, nil
}

func (r *OrganizationMemberRepository) GetByOrgAndUserID(orgID, userID uint) (*model.OrganizationMember, error) {
	var member model.OrganizationMember
	err := r.db.Where("organization_id = ? AND user_id = ?", orgID, userID).First(&member).Error
	if err != nil {
		return nil, err
	}
	return &member, nil
}

func (r *OrganizationMemberRepository) ListByOrgID(orgID uint) ([]model.OrganizationMember, error) {
	var members []model.OrganizationMember
	err := r.db.Where("organization_id = ?", orgID).Find(&members).Error
	return members, err
}

func (r *OrganizationMemberRepository) ListByUserID(userID uint) ([]model.OrganizationMember, error) {
	var members []model.OrganizationMember
	err := r.db.Where("user_id = ?", userID).Find(&members).Error
	return members, err
}

func (r *OrganizationMemberRepository) Update(member *model.OrganizationMember) error {
	return r.db.Save(member).Error
}

func (r *OrganizationMemberRepository) Delete(id uint) error {
	return r.db.Delete(&model.OrganizationMember{}, id).Error
}

func (r *OrganizationMemberRepository) DeleteByOrgAndUserID(orgID, userID uint) error {
	return r.db.Where("organization_id = ? AND user_id = ?", orgID, userID).Delete(&model.OrganizationMember{}).Error
}

func (r *OrganizationMemberRepository) CountByOrgID(orgID uint) (int64, error) {
	var count int64
	err := r.db.Model(&model.OrganizationMember{}).Where("organization_id = ?", orgID).Count(&count).Error
	return count, err
}

func (r *OrganizationMemberRepository) IsMember(orgID, userID uint) bool {
	var member model.OrganizationMember
	err := r.db.Where("organization_id = ? AND user_id = ?", orgID, userID).First(&member).Error
	return err == nil
}

func (r *OrganizationMemberRepository) IsOwner(orgID, userID uint) bool {
	var member model.OrganizationMember
	err := r.db.Where("organization_id = ? AND user_id = ? AND role = ?", orgID, userID, "owner").First(&member).Error
	return err == nil
}

func (r *OrganizationMemberRepository) IsAdmin(orgID, userID uint) bool {
	var member model.OrganizationMember
	err := r.db.Where("organization_id = ? AND user_id = ? AND role IN ?", orgID, userID, []string{"owner", "admin"}).First(&member).Error
	return err == nil
}