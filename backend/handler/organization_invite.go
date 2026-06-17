package handler

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strconv"
	"time"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type OrganizationInviteHandler struct{}

// CreateInviteInput represents the input for creating an invitation
type CreateInviteInput struct {
	ExpiresIn *int `json:"expires_in"` // expiration in hours (nil = no expiration)
	MaxUses   *int `json:"max_uses"`   // max uses (nil = 1)
}

// AcceptInviteInput represents the input for accepting an invitation
type AcceptInviteInput struct {
	Code string `json:"code" binding:"required"`
}

// generateInviteCode generates a random invite code
func generateInviteCode() string {
	bytes := make([]byte, 16)
	rand.Read(bytes)
	return hex.EncodeToString(bytes)
}

// CreateInvitation creates a new invitation for an organization (owner/admin only)
func (h *OrganizationInviteHandler) CreateInvitation(c *gin.Context) {
	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	var input CreateInviteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	// Check if user is admin or owner, or global admin, or system admin
	if !memberRepo.IsAdmin(org.ID, userID) && !permissions.HasGlobalAdmin(userPerms) && c.GetString("role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
		return
	}

	// Build invite
	maxUses := 1
	if input.MaxUses != nil && *input.MaxUses > 0 {
		maxUses = *input.MaxUses
	}

	var expiresAt *time.Time
	if input.ExpiresIn != nil && *input.ExpiresIn > 0 {
		t := time.Now().Add(time.Duration(*input.ExpiresIn) * time.Hour)
		expiresAt = &t
	}

	invite := &model.OrganizationInvite{
		OrganizationID: org.ID,
		Code:           generateInviteCode(),
		CreatedBy:      userID,
		MaxUses:        maxUses,
		ExpiresAt:      expiresAt,
	}

	inviteRepo := repository.NewOrganizationInviteRepository(database.DB)
	if err := inviteRepo.Create(invite); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invitation"})
		return
	}

	c.JSON(http.StatusCreated, invite)
}

// AcceptInvitation accepts an invitation and joins the organization
func (h *OrganizationInviteHandler) AcceptInvitation(c *gin.Context) {
	var input AcceptInviteInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetUint("user_id")

	tx := database.DB.Begin()

	// Find the invite with row lock to prevent concurrent acceptance
	var invite model.OrganizationInvite
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("code = ?", input.Code).First(&invite).Error; err != nil {
		tx.Rollback()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid invitation code"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get invitation"})
		return
	}

	// Check if expired
	if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invitation expired"})
		return
	}

	// Check if max uses reached
	if invite.UseCount >= invite.MaxUses {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invitation no longer valid"})
		return
	}

	// Check if user is already a member (inside the transaction)
	var existingMember model.OrganizationMember
	if err := tx.Where("organization_id = ? AND user_id = ?", invite.OrganizationID, userID).First(&existingMember).Error; err == nil {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "You are already a member"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check membership"})
		return
	}

	// Add user as member
	member := &model.OrganizationMember{
		OrganizationID: invite.OrganizationID,
		UserID:         userID,
		Role:           "member",
	}

	if err := tx.Create(member).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to join organization"})
		return
	}

	// Increment use count
	if err := tx.Model(&invite).UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update invitation"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Successfully joined organization", "organization_id": invite.OrganizationID})
}

// RevokeInvitation revokes a pending invitation (owner/admin only)
func (h *OrganizationInviteHandler) RevokeInvitation(c *gin.Context) {
	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	inviteIDStr := c.Param("inviteId")
	inviteID, err := strconv.ParseUint(inviteIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid invitation ID"})
		return
	}

	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	// Check if user is admin or owner, or global admin, or system admin
	if !memberRepo.IsAdmin(org.ID, userID) && !permissions.HasGlobalAdmin(userPerms) && c.GetString("role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
		return
	}

	inviteRepo := repository.NewOrganizationInviteRepository(database.DB)
	invite, err := inviteRepo.GetByID(uint(inviteID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Invitation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get invitation"})
		return
	}

	// Verify invite belongs to this organization
	if invite.OrganizationID != org.ID {
		c.JSON(http.StatusNotFound, gin.H{"error": "Invitation not found"})
		return
	}

	// Soft-delete the invite to revoke it
	if err := inviteRepo.Delete(invite.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke invitation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Invitation revoked"})
}

// ListInvitations lists all invitations for an organization (owner/admin only)
func (h *OrganizationInviteHandler) ListInvitations(c *gin.Context) {
	orgRepo := repository.NewOrganizationRepository(database.DB)
	org, err := orgRepo.GetByUUID(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Organization not found"})
		return
	}

	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	isAdmin := memberRepo.IsAdmin(org.ID, userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isSystemAdmin := c.GetString("role") == "admin"

	if !isAdmin && !isGlobalAdmin && !isSystemAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Admin access required"})
		return
	}

	inviteRepo := repository.NewOrganizationInviteRepository(database.DB)
	invites, err := inviteRepo.ListByOrgID(org.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list invitations"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"invitations": invites})
}

// ListMyPendingInvites lists pending invitations for the current user
func (h *OrganizationInviteHandler) ListMyPendingInvites(c *gin.Context) {
	userID := c.GetUint("user_id")

	inviteRepo := repository.NewOrganizationInviteRepository(database.DB)
	invites, err := inviteRepo.ListByTargetUserID(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list invitations"})
		return
	}

	// Filter out expired, used, or deleted invites; enrich with org name
	type PendingInvite struct {
		ID             uint   `json:"id"`
		OrganizationID uint   `json:"organization_id"`
		OrganizationName string `json:"organization_name"`
		CreatedBy      uint   `json:"created_by"`
		CreatedAt      time.Time `json:"created_at"`
	}

	result := make([]PendingInvite, 0, len(invites))
	orgRepo := repository.NewOrganizationRepository(database.DB)
	for _, inv := range invites {
		if inv.DeletedAt.Valid {
			continue
		}
		if inv.UseCount >= inv.MaxUses {
			continue
		}
		if inv.ExpiresAt != nil && inv.ExpiresAt.Before(time.Now()) {
			continue
		}
		org, err := orgRepo.GetByID(inv.OrganizationID)
		orgName := ""
		if err == nil {
			orgName = org.Name
		}
		result = append(result, PendingInvite{
			ID:               inv.ID,
			OrganizationID:   inv.OrganizationID,
			OrganizationName: orgName,
			CreatedBy:        inv.CreatedBy,
			CreatedAt:        inv.CreatedAt,
		})
	}

	c.JSON(http.StatusOK, gin.H{"invitations": result})
}

// AcceptTargetedInvite accepts a targeted invitation (invite must be for the current user)
func (h *OrganizationInviteHandler) AcceptTargetedInvite(c *gin.Context) {
	inviteIDStr := c.Param("inviteId")
	inviteID, err := strconv.ParseUint(inviteIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid invitation ID"})
		return
	}

	userID := c.GetUint("user_id")

	tx := database.DB.Begin()

	// Find the invite with row lock to prevent concurrent acceptance
	var invite model.OrganizationInvite
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&invite, uint(inviteID)).Error; err != nil {
		tx.Rollback()
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Invitation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get invitation"})
		return
	}

	// Must be a targeted invite for this user
	if invite.TargetUserID == nil || *invite.TargetUserID != userID {
		tx.Rollback()
		c.JSON(http.StatusForbidden, gin.H{"error": "This invitation is not for you"})
		return
	}

	// Check if expired
	if invite.ExpiresAt != nil && invite.ExpiresAt.Before(time.Now()) {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invitation expired"})
		return
	}

	// Check if max uses reached
	if invite.UseCount >= invite.MaxUses {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invitation no longer valid"})
		return
	}

	// Check if user is already a member (inside the transaction)
	var existingMember model.OrganizationMember
	if err := tx.Where("organization_id = ? AND user_id = ?", invite.OrganizationID, userID).First(&existingMember).Error; err == nil {
		tx.Rollback()
		c.JSON(http.StatusBadRequest, gin.H{"error": "You are already a member"})
		return
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to check membership"})
		return
	}

	// Add user as member
	member := &model.OrganizationMember{
		OrganizationID: invite.OrganizationID,
		UserID:         userID,
		Role:           "member",
	}

	if err := tx.Create(member).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to join organization"})
		return
	}

	// Mark invite as used
	if err := tx.Model(&invite).UpdateColumn("use_count", gorm.Expr("use_count + 1")).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update invitation"})
		return
	}

	tx.Commit()

	c.JSON(http.StatusOK, gin.H{"message": "Successfully joined organization", "organization_id": invite.OrganizationID})
}

// DeclineInvite declines (soft-deletes) a targeted invitation
func (h *OrganizationInviteHandler) DeclineInvite(c *gin.Context) {
	inviteIDStr := c.Param("inviteId")
	inviteID, err := strconv.ParseUint(inviteIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid invitation ID"})
		return
	}

	userID := c.GetUint("user_id")
	inviteRepo := repository.NewOrganizationInviteRepository(database.DB)

	invite, err := inviteRepo.GetByID(uint(inviteID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Invitation not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get invitation"})
		return
	}

	// Must be a targeted invite for this user
	if invite.TargetUserID == nil || *invite.TargetUserID != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "This invitation is not for you"})
		return
	}

	if err := inviteRepo.Delete(invite.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to decline invitation"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Invitation declined"})
}
