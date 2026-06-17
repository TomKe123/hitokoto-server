package handler

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/middleware"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type OrganizationHandler struct{}

type CreateOrganizationInput struct {
	Name        string `json:"name" binding:"required,min=2,max=100"`
	Description string `json:"description" binding:"max=500"`
}

type UpdateOrganizationInput struct {
	Name        *string `json:"name" binding:"min=2,max=100"`
	Description *string `json:"description" binding:"max=500"`
}

// CreateOrganization creates a new organization
func (h *OrganizationHandler) CreateOrganization(c *gin.Context) {
	userID := c.GetUint("user_id")
	var input CreateOrganizationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Check if organization name already exists
	orgRepo := repository.NewOrganizationRepository(database.DB)
	existing, _ := orgRepo.GetByName(input.Name)
	if existing != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Organization name already exists"})
		return
	}

	// Create organization
	org := &model.Organization{
		Name:        input.Name,
		Description: input.Description,
		OwnerID:     userID,
	}

	if err := orgRepo.Create(org); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create organization"})
		return
	}

	// Add owner as member
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)
	member := &model.OrganizationMember{
		OrganizationID: org.ID,
		UserID:         userID,
		Role:           "owner",
	}
	if err := memberRepo.Create(member); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add owner as member"})
		return
	}

	c.JSON(http.StatusCreated, org)
}

// GetOrganization gets organization by ID
func (h *OrganizationHandler) GetOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get organization"})
		return
	}

	// Check if user is member or global admin
	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	isMember := memberRepo.IsMember(org.ID, userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isAdmin := c.GetString("role") == "admin"

	if !isMember && !isGlobalAdmin && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Get member count
	memberCount, _ := memberRepo.CountByOrgID(org.ID)
	c.JSON(http.StatusOK, gin.H{"organization": org, "member_count": memberCount})
}

// ListOrganizations lists all organizations
func (h *OrganizationHandler) ListOrganizations(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	orgRepo := repository.NewOrganizationRepository(database.DB)
	orgs, total, err := orgRepo.List(page, pageSize)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list organizations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"organizations": orgs,
		"total":         total,
		"page":          page,
		"page_size":     pageSize,
	})
}

// UpdateOrganization updates an organization
func (h *OrganizationHandler) UpdateOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	var input UpdateOrganizationInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get organization"})
		return
	}

	// Check permission: owner or global admin
	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	isOwner := memberRepo.IsOwner(org.ID, userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isAdmin := c.GetString("role") == "admin"

	if !isOwner && !isGlobalAdmin && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	// Update fields
	if input.Name != nil {
		// Check if name is taken
		existing, _ := orgRepo.GetByName(*input.Name)
		if existing != nil && existing.ID != org.ID {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Organization name already exists"})
			return
		}
		org.Name = *input.Name
	}
	if input.Description != nil {
		org.Description = *input.Description
	}

	if err := orgRepo.Update(org); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update organization"})
		return
	}

	c.JSON(http.StatusOK, org)
}

// DeleteOrganization deletes an organization
func (h *OrganizationHandler) DeleteOrganization(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByID(uint(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get organization"})
		return
	}

	// Check permission: owner or global admin
	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	isOwner := memberRepo.IsOwner(org.ID, userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isAdmin := c.GetString("role") == "admin"

	if !isOwner && !isGlobalAdmin && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := orgRepo.Delete(org.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete organization"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Organization deleted"})
}

// GetMyOrganizations returns organizations where the user is a member
func (h *OrganizationHandler) GetMyOrganizations(c *gin.Context) {
	userID := c.GetUint("user_id")

	memberRepo := repository.NewOrganizationMemberRepository(database.DB)
	members, err := memberRepo.ListByUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get organizations"})
		return
	}

	orgRepo := repository.NewOrganizationRepository(database.DB)
	var orgs []model.Organization
	for _, m := range members {
		org, err := orgRepo.GetByID(m.OrganizationID)
		if err == nil {
			orgs = append(orgs, *org)
		}
	}

	c.JSON(http.StatusOK, gin.H{"organizations": orgs})
}

// TransferOwnership transfers organization ownership to another member
func (h *OrganizationHandler) TransferOwnership(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	var input struct {
		NewOwnerID uint `json:"new_owner_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByID(uint(id))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	// Check if current user is owner
	userID := c.GetUint("user_id")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	if !memberRepo.IsOwner(org.ID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only owner can transfer ownership"})
		return
	}

	// Check if new owner is a member
	if !memberRepo.IsMember(org.ID, input.NewOwnerID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "New owner must be a member"})
		return
	}

	// Update roles
	tx := database.DB.Begin()

	// Demote current owner to member
	currentOwnerMember, _ := memberRepo.GetByOrgAndUserID(org.ID, userID)
	currentOwnerMember.Role = "member"
	if err := tx.Save(currentOwnerMember).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update role"})
		return
	}

	// Promote new owner to owner
	newOwnerMember, _ := memberRepo.GetByOrgAndUserID(org.ID, input.NewOwnerID)
	newOwnerMember.Role = "owner"
	if err := tx.Save(newOwnerMember).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update role"})
		return
	}

	// Update organization owner
	org.OwnerID = input.NewOwnerID
	if err := tx.Save(org).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update owner"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Ownership transferred"})
}

// GetOrganizationMembers returns members of an organization
func (h *OrganizationHandler) GetOrganizationMembers(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	// Check permission
	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	isMember := memberRepo.IsMember(uint(id), userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isAdmin := c.GetString("role") == "admin"

	if !isMember && !isGlobalAdmin && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	members, err := memberRepo.ListByOrgID(uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get members"})
		return
	}

	// Enrich members with usernames
	userIDs := make([]uint, 0, len(members))
	for _, m := range members {
		userIDs = append(userIDs, m.UserID)
	}
	userMap := make(map[uint]string)
	if len(userIDs) > 0 {
		userInfos, _ := repository.FindUsersByIDs(userIDs)
		for _, ui := range userInfos {
			userMap[ui.ID] = ui.Username
		}
	}

	type memberWithUsername struct {
		ID             uint   `json:"id"`
		OrganizationID uint   `json:"organization_id"`
		UserID         uint   `json:"user_id"`
		Username       string `json:"username"`
		Role           string `json:"role"`
		CreatedAt      time.Time `json:"created_at"`
	}

	enriched := make([]memberWithUsername, 0, len(members))
	for _, m := range members {
		enriched = append(enriched, memberWithUsername{
			ID:             m.ID,
			OrganizationID: m.OrganizationID,
			UserID:         m.UserID,
			Username:       userMap[m.UserID],
			Role:           m.Role,
			CreatedAt:      m.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"members": enriched})
}

// --- Middleware to check organization access ---

func OrganizationAuthMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		orgIDStr := c.Param("id")
		orgID, err := strconv.ParseUint(orgIDStr, 10, 64)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
			return
		}

		userID := c.GetUint("user_id")
		userPerms := c.GetUint64("permissions")

		memberRepo := repository.NewOrganizationMemberRepository(database.DB)
		isMember := memberRepo.IsMember(uint(orgID), userID)
		isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
		isAdmin := c.GetString("role") == "admin"

		if !isMember && !isGlobalAdmin && !isAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Access denied"})
			return
		}

		c.Set("organization_id", uint(orgID))
		c.Next()
	}
}

// RequireOrgOwner requires organization owner role
func RequireOrgOwner() gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID := c.GetUint("organization_id")
		userID := c.GetUint("user_id")

		memberRepo := repository.NewOrganizationMemberRepository(database.DB)
		if !memberRepo.IsOwner(orgID, userID) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Owner access required"})
			return
		}

		c.Next()
	}
}

// RequireOrgAdmin requires organization admin or owner role
func RequireOrgAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		orgID := c.GetUint("organization_id")
		userID := c.GetUint("user_id")

		memberRepo := repository.NewOrganizationMemberRepository(database.DB)
		if !memberRepo.IsAdmin(orgID, userID) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
			return
		}

		c.Next()
	}
}

// RequireGlobalAdmin requires global admin permission
func RequireGlobalAdmin() gin.HandlerFunc {
	return func(c *gin.Context) {
		userRole := c.GetString("role")
		if userRole == "admin" {
			c.Next()
			return
		}
		userPerms := c.GetUint64("permissions")
		if !permissions.HasGlobalAdmin(userPerms) {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Global admin access required"})
			return
		}
		c.Next()
	}
}

// GetOrganizationLists returns all lists belonging to this organization
func (h *OrganizationHandler) GetOrganizationLists(c *gin.Context) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	// Verify membership
	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)
	isMember := memberRepo.IsMember(uint(id), userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isAdmin := c.GetString("role") == "admin"
	if !isMember && !isGlobalAdmin && !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	lists, err := repository.GetListsByOrgID(uint(id))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get lists"})
		return
	}

	// Exclude lists not shared with the organization
	filtered := make([]model.QuoteList, 0, len(lists))
	for _, l := range lists {
		if l.ShareType != "none" {
			filtered = append(filtered, l)
		}
	}

	c.JSON(http.StatusOK, gin.H{"lists": filtered})
}

// init for handler registration
var _ = middleware.AuthMiddleware