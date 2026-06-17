package handler

import (
	"errors"
	"net/http"
	"strconv"

	"hitokoto-server/backend/database"
	"hitokoto-server/backend/model"
	"hitokoto-server/backend/permissions"
	"hitokoto-server/backend/repository"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type OrganizationMemberHandler struct{}

// AddMemberInput represents the input for adding a member
type AddMemberInput struct {
	UserID uint `json:"user_id" binding:"required"`
}

// AddMember invites a user to join the organization (owner/admin only).
// Creates a targeted invite that the user must accept.
func (h *OrganizationMemberHandler) AddMember(c *gin.Context) {
	orgIDStr := c.Param("id")
	orgID, err := strconv.ParseUint(orgIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	var input AddMemberInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	// Check if current user is owner or admin, or global admin, or system admin
	if !memberRepo.IsAdmin(uint(orgID), userID) && !permissions.HasGlobalAdmin(userPerms) && c.GetString("role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only owner or admin can invite members"})
		return
	}

	// Check if target user is already a member
	if memberRepo.IsMember(uint(orgID), input.UserID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "User is already a member"})
		return
	}

	// Check if target user exists
	_, err = repository.FindUserByID(input.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "User not found"})
		return
	}

	// Check if there's already a pending invite for this user+org
	inviteRepo := repository.NewOrganizationInviteRepository(database.DB)
	existingInvites, _ := inviteRepo.ListByTargetUserID(input.UserID)
	for _, inv := range existingInvites {
		if inv.OrganizationID == uint(orgID) && inv.DeletedAt.Time.IsZero() {
			c.JSON(http.StatusBadRequest, gin.H{"error": "User already has a pending invitation"})
			return
		}
	}

	// Create a targeted invite (no code needed)
	invite := &model.OrganizationInvite{
		OrganizationID: uint(orgID),
		Code:           "", // code-based invites still work separately
		CreatedBy:      userID,
		TargetUserID:   &input.UserID,
		MaxUses:        1,
	}

	if err := inviteRepo.Create(invite); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create invitation"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"message": "Invitation sent", "invite_id": invite.ID})
}

// RemoveMember removes a member from an organization (owner/admin only)
func (h *OrganizationMemberHandler) RemoveMember(c *gin.Context) {
	orgIDStr := c.Param("id")
	orgID, err := strconv.ParseUint(orgIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	memberIDStr := c.Param("memberId")
	memberID, err := strconv.ParseUint(memberIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid member ID"})
		return
	}

	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	// Find the target member
	targetMember, err := memberRepo.GetByID(uint(memberID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Member not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get member"})
		return
	}

	// Check if target is the owner (cannot remove owner)
	if targetMember.Role == "owner" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot remove the owner"})
		return
	}

	// Check permission: owner can remove anyone, admin can remove members (not other admins)
	isOwner := memberRepo.IsOwner(uint(orgID), userID)
	isAdmin := memberRepo.IsAdmin(uint(orgID), userID)
	isGlobalAdmin := permissions.HasGlobalAdmin(userPerms)
	isSystemAdmin := c.GetString("role") == "admin"

	if isGlobalAdmin || isSystemAdmin {
		// Global admin can remove any member
	} else if isOwner {
		// Owner can remove any non-owner member
	} else if isAdmin && targetMember.Role == "member" {
		// Admin can only remove regular members
	} else {
		c.JSON(http.StatusForbidden, gin.H{"error": "Access denied"})
		return
	}

	if err := memberRepo.Delete(targetMember.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member removed"})
}

// ChangeMemberRoleInput represents the input for changing a member's role
type ChangeMemberRoleInput struct {
	Role string `json:"role" binding:"required,oneof=admin member"`
}

// ChangeMemberRole changes a member's role (owner only)
func (h *OrganizationMemberHandler) ChangeMemberRole(c *gin.Context) {
	orgIDStr := c.Param("id")
	orgID, err := strconv.ParseUint(orgIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	memberIDStr := c.Param("memberId")
	memberID, err := strconv.ParseUint(memberIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid member ID"})
		return
	}

	var input ChangeMemberRoleInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	userID := c.GetUint("user_id")
	userPerms := c.GetUint64("permissions")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	// Find the target member
	targetMember, err := memberRepo.GetByID(uint(memberID))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Member not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get member"})
		return
	}

	// Cannot change owner's role
	if targetMember.Role == "owner" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot change owner's role"})
		return
	}

	// Only owner can change roles (by design, admin can only manage members, not change roles)
	// Global admin and system admin bypass this check
	if !memberRepo.IsOwner(uint(orgID), userID) && !permissions.HasGlobalAdmin(userPerms) && c.GetString("role") != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only owner can change roles"})
		return
	}

	targetMember.Role = input.Role
	if err := memberRepo.Update(targetMember); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update role"})
		return
	}

	c.JSON(http.StatusOK, targetMember)
}

// LeaveOrganization allows a member to leave an organization
func (h *OrganizationMemberHandler) LeaveOrganization(c *gin.Context) {
	orgIDStr := c.Param("id")
	orgID, err := strconv.ParseUint(orgIDStr, 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid organization ID"})
		return
	}

	userID := c.GetUint("user_id")
	memberRepo := repository.NewOrganizationMemberRepository(database.DB)

	// Find the member record
	member, err := memberRepo.GetByOrgAndUserID(uint(orgID), userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "You are not a member"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get membership"})
		return
	}

	// Owner cannot leave, must transfer ownership first
	if member.Role == "owner" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Transfer ownership first"})
		return
	}

	if err := memberRepo.Delete(member.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to leave organization"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Left organization"})
}
