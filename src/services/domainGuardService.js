const AppError = require('../utils/AppError');
const accessControlService = require('./accessControlService');

const domainGuardService = {
  cannotApproveOwnRequest(actorId, requesterId) {
    if (actorId === requesterId) throw new AppError('You cannot approve your own request', 403);
  },

  cannotEditAfterFinalState(record, label, finalStates = []) {
    if (!record) return;
    if (record.lockedAt || finalStates.includes(record.status) || finalStates.includes(record.approvalStatus)) {
      throw new AppError(`${label} is in a final state and can no longer be modified`, 400);
    }
  },

  cannotAccessOtherDepartmentData(auth, departmentId) {
    if (departmentId && !accessControlService.hasDepartmentAccess(auth, departmentId) && !accessControlService.isGeneralManager(auth) && !accessControlService.isHr(auth)) {
      throw new AppError('You do not have access to data for this department', 403);
    }
  },

  cannotViewUnauthorizedSalary(auth, employeeId) {
    if (!accessControlService.canViewPayroll(auth, employeeId)) {
      throw new AppError('You do not have access to salary information', 403);
    }
  },

  cannotModifyApprovedRecords(record, label) {
    if (record?.status === 'APPROVED' || record?.approvalStatus === 'APPROVED') {
      throw new AppError(`${label} is already approved and cannot be modified directly`, 400);
    }
  },

  cannotDeleteReferencedRecords(referenceCount, label) {
    if (referenceCount > 0) throw new AppError(`${label} cannot be deleted because it is referenced by other records`, 400);
  }
};

module.exports = domainGuardService;
