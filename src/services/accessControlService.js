const AppError = require('../utils/AppError');
const { ROLES, normalizeRoleName } = require('../constants/roles');

const accessControlService = {
  getRoleName(auth) {
    return normalizeRoleName(auth?.roleName);
  },

  isGeneralManager(auth) {
    return this.getRoleName(auth) === ROLES.GENERAL_MANAGER;
  },

  isDepartmentHead(auth) {
    return this.getRoleName(auth) === ROLES.DEPARTMENT_HEAD;
  },

  isHr(auth) {
    return this.getRoleName(auth) === ROLES.HR_MANAGER;
  },

  isFinance(auth) {
    return this.getRoleName(auth) === ROLES.FINANCE_ACCOUNTS_MANAGER;
  },

  isSalesCompliance(auth) {
    return this.getRoleName(auth) === ROLES.SALES_COMPLIANCE_OFFICER;
  },

  isOperations(auth) {
    return this.getRoleName(auth) === ROLES.OPERATIONS_PROCUREMENT_OFFICER;
  },

  hasDepartmentAccess(auth, departmentId) {
    if (!departmentId) return false;
    if (this.isGeneralManager(auth) || this.isHr(auth)) return true;
    return auth?.departmentIds?.includes(departmentId);
  },

  assertDepartmentAccess(auth, departmentId, message = 'You do not have access to this department') {
    if (!this.hasDepartmentAccess(auth, departmentId)) throw new AppError(message, 403);
  },

  canViewUser(auth, targetUser) {
    if (!auth || !targetUser) return false;
    if (this.isGeneralManager(auth) || this.isHr(auth)) return true;
    if (auth.userId === targetUser.id) return true;
    if (this.isDepartmentHead(auth) && targetUser.departmentId && auth.departmentIds?.includes(targetUser.departmentId)) return true;
    return false;
  },

  assertUserViewAccess(auth, targetUser) {
    if (!this.canViewUser(auth, targetUser)) throw new AppError('You do not have access to this staff record', 403);
  },

  canManageUser(auth, targetUser) {
    if (this.isGeneralManager(auth) || this.isHr(auth)) return true;
    if (this.isDepartmentHead(auth) && targetUser?.departmentId && auth.departmentIds?.includes(targetUser.departmentId)) {
      return normalizeRoleName(targetUser.role?.name) !== ROLES.GENERAL_MANAGER;
    }
    return false;
  },

  assertUserManageAccess(auth, targetUser) {
    if (!this.canManageUser(auth, targetUser)) throw new AppError('You do not have permission to manage this staff record', 403);
  },

  canViewPayroll(auth, targetUserId) {
    if (!auth) return false;
    if (auth.userId === targetUserId) return true;
    return this.isGeneralManager(auth) || this.isFinance(auth);
  },

  assertPayrollAccess(auth, targetUserId) {
    if (!this.canViewPayroll(auth, targetUserId)) throw new AppError('You do not have access to payroll information', 403);
  },

  canAccessChannel(auth, channel) {
    if (!auth || !channel) return false;
    if (this.isGeneralManager(auth)) return true;
    if (channel.isCompany) return true;
    if (channel.departmentId) return this.hasDepartmentAccess(auth, channel.departmentId);
    return false;
  },

  assertChannelAccess(auth, channel) {
    if (!this.canAccessChannel(auth, channel)) throw new AppError('You do not have access to this channel', 403);
  },

  canAccessDocument(auth, document) {
    if (!auth || !document) return false;
    if (this.isGeneralManager(auth)) return true;
    if (document.visibility === 'COMPANY_INTERNAL') return true;
    if (document.departmentId && document.visibility === 'DEPARTMENT_ONLY') return this.hasDepartmentAccess(auth, document.departmentId);
    if (document.ownerType === 'USER' && document.ownerId === auth.userId) return true;
    if (document.uploadedById === auth.userId) return true;
    if (document.ownerType === 'FINANCE' && this.isFinance(auth)) return true;
    if (document.ownerType === 'COMPLIANCE' && this.isSalesCompliance(auth)) return true;
    if (document.ownerType === 'HR' && this.isHr(auth)) return true;
    if (document.ownerType === 'OPERATIONS' && this.isOperations(auth)) return true;
    if (document.departmentId && this.hasDepartmentAccess(auth, document.departmentId)) return true;
    return false;
  },

  assertDocumentAccess(auth, document) {
    if (!this.canAccessDocument(auth, document)) throw new AppError('You do not have access to this document', 403);
  }
};

module.exports = accessControlService;
