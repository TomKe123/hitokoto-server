package repository

import (
	"hitokoto-server/backend/model"

	"gorm.io/gorm"
)

type OrganizationRepository struct {
	db *gorm.DB
}

func NewOrganizationRepository(db *gorm.DB) *OrganizationRepository {
	return &OrganizationRepository{db: db}
}

func (r *OrganizationRepository) Create(org *model.Organization) error {
	return r.db.Create(org).Error
}

func (r *OrganizationRepository) GetByUUID(uuid string) (*model.Organization, error) {
	var org model.Organization
	err := r.db.Where("uuid = ?", uuid).First(&org).Error
	if err != nil {
		return nil, err
	}
	return &org, nil
}

func (r *OrganizationRepository) GetByID(id uint) (*model.Organization, error) {
	var org model.Organization
	err := r.db.First(&org, id).Error
	if err != nil {
		return nil, err
	}
	return &org, nil
}

func (r *OrganizationRepository) GetByName(name string) (*model.Organization, error) {
	var org model.Organization
	err := r.db.Where("name = ?", name).First(&org).Error
	if err != nil {
		return nil, err
	}
	return &org, nil
}

func (r *OrganizationRepository) List(page, pageSize int) ([]model.Organization, int64, error) {
	var orgs []model.Organization
	var total int64

	query := r.db.Model(&model.Organization{})
	query.Count(&total)

	err := query.Offset((page - 1) * pageSize).Limit(pageSize).Find(&orgs).Error
	return orgs, total, err
}

func (r *OrganizationRepository) Update(org *model.Organization) error {
	return r.db.Save(org).Error
}

func (r *OrganizationRepository) Delete(id uint) error {
	return r.db.Delete(&model.Organization{}, id).Error
}

func (r *OrganizationRepository) GetByOwnerID(ownerID uint) ([]model.Organization, error) {
	var orgs []model.Organization
	err := r.db.Where("owner_id = ?", ownerID).Find(&orgs).Error
	return orgs, err
}