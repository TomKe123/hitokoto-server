package permissions

const (
	PermReview           uint64 = 1 << 0  // 审核权限：审批/驳回语录
	PermCategory         uint64 = 1 << 1  // 分类管理权限：创建/分类
	PermDeleteQuote      uint64 = 1 << 2  // 删除权限：删除任意语录
	PermUpload           uint64 = 1 << 3  // 上传权限：提交语录
	PermManageLists      uint64 = 1 << 4  // 列表管理权限：查看/删除所有列表
	PermGlobalAdmin      uint64 = 1 << 5  // 全局管理权限：跨组织管理
	PermAll              uint64 = PermReview | PermCategory | PermDeleteQuote | PermUpload | PermManageLists | PermGlobalAdmin
)

func Has(perms, perm uint64) bool {
	return (perms & perm) != 0
}

func HasGlobalAdmin(perms uint64) bool {
	return Has(perms, PermGlobalAdmin)
}
