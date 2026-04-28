const prisma = require('../prisma/client');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const stateMachineService = require('./stateMachineService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const pickAuditAction = (type) => (
  ['DOCUMENT'].includes(type) ? AUDIT_ACTIONS.DOCUMENT_APPROVED : type === 'PAYSLIP' ? AUDIT_ACTIONS.PAYROLL_UPDATED : AUDIT_ACTIONS.COMPLIANCE_UPDATED
);

async function auditStatusChange({ tx, actorId, req, entityType, entityId, oldStatus, newStatus, extra = {}, action }) {
  await auditService.log({
    actorId,
    action: action || pickAuditAction(String(entityType || '').toUpperCase()),
    entityType,
    entityId,
    oldValues: { status: oldStatus },
    newValues: { status: newStatus, ...extra },
    req
  }, tx);
}

const workflowOrchestratorService = {
  async lockRecord(model, id, tx = prisma) {
    return tx[model].update({ where: { id }, data: { lockedAt: new Date() } });
  },

  async onApprovalApproved(entityType, entityId, context = {}, tx = prisma) {
    const type = String(entityType || '').toUpperCase();

    if (type === 'LEAVE_REQUEST') {
      const leave = await tx.leaveRequest.findUnique({ where: { id: entityId } });
      if (!leave) return null;
      stateMachineService.assertTransition('LEAVE', leave.status, 'APPROVED');
      await tx.leaveRequest.update({ where: { id: entityId }, data: { status: 'APPROVED' } });
      const balance = await tx.leaveBalance.findUnique({
        where: {
          employeeId_leaveType_year: {
            employeeId: leave.employeeId,
            leaveType: leave.leaveType,
            year: new Date(leave.startDate).getFullYear()
          }
        }
      });
      if (balance) {
        await tx.leaveBalance.update({
          where: { id: balance.id },
          data: {
            pending: { decrement: leave.days },
            used: { increment: leave.days }
          }
        });
      }
      for (let day = new Date(leave.startDate); day <= leave.endDate; day.setDate(day.getDate() + 1)) {
        const date = startOfDay(day);
        await tx.attendanceRecord.upsert({
          where: { employeeId_date: { employeeId: leave.employeeId, date } },
          update: { status: 'ON_LEAVE' },
          create: { employeeId: leave.employeeId, date, status: 'ON_LEAVE' }
        });
      }
      await this.lockRecord('leaveRequest', entityId, tx);
      await auditService.log({
        actorId: context.actorId,
        action: AUDIT_ACTIONS.LEAVE_APPROVED,
        entityType: 'LeaveRequest',
        entityId,
        oldValues: { status: leave.status },
        newValues: { status: 'APPROVED', lockedAt: new Date() },
        req: context.req
      }, tx);
      await notificationService.create({ userId: leave.employeeId, type: 'LEAVE_STATUS_CHANGED', title: 'Leave approved', body: 'Your leave request has been approved.', entityType: 'LeaveRequest', entityId }, tx);
      return leave;
    }

    if (type === 'FINANCE_REQUEST') {
      const existing = await tx.financeRequest.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      stateMachineService.assertTransition('FINANCE_REQUEST', existing.status, 'APPROVED');
      const request = await tx.financeRequest.update({ where: { id: entityId }, data: { status: 'APPROVED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'FinanceRequest', entityId, oldStatus: existing.status, newStatus: 'APPROVED', action: AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED });
      await notificationService.create({ userId: request.requestedById, type: 'EXPENSE_STATUS_CHANGED', title: request.title, body: 'Finance request approved', entityType: 'FinanceRequest', entityId }, tx);
      return request;
    }

    if (type === 'DOCUMENT') {
      const existing = await tx.document.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.document.update({ where: { id: entityId }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: context.actorId || undefined, rejectionReason: null } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Document', entityId, oldStatus: existing.status, newStatus: 'APPROVED', extra: { approvedById: context.actorId || null } });
      if (updated.uploadedById && updated.uploadedById !== context.actorId) {
        await notificationService.create({ userId: updated.uploadedById, type: 'DOCUMENT_UPLOADED', title: 'Document approved', body: updated.title, entityType: 'Document', entityId }, tx);
      }
      return updated;
    }

    if (type === 'HR_ACTION') {
      const action = await tx.hRAction.findUnique({ where: { id: entityId } });
      if (!action) return null;
      const changes = action.changes && typeof action.changes === 'object' ? action.changes : {};
      const userData = {};
      if (changes.roleId) userData.roleId = changes.roleId;
      if (changes.departmentId) userData.departmentId = changes.departmentId;
      if (changes.managerId) userData.managerId = changes.managerId;
      if (action.actionType === 'SUSPENSION') {
        userData.employmentStatus = 'SUSPENDED';
        userData.isActive = false;
      }
      if (action.actionType === 'TERMINATION') {
        userData.employmentStatus = 'TERMINATED';
        userData.isActive = false;
      }
      if ((action.actionType === 'PROMOTION' || changes.uiActionType === 'DEMOTION') && changes.jobTitle) userData.jobTitle = changes.jobTitle;
      if (Object.keys(userData).length) {
        const before = await tx.user.findUnique({ where: { id: action.employeeId } });
        const after = await tx.user.update({ where: { id: action.employeeId }, data: userData });
        await auditService.log({
          actorId: context.actorId,
          action: AUDIT_ACTIONS.USER_UPDATED,
          entityType: 'User',
          entityId: action.employeeId,
          oldValues: before,
          newValues: after,
          req: context.req
        }, tx);
      }

      const salaryValue = changes.newSalary !== undefined && changes.newSalary !== null && changes.newSalary !== ''
        ? Number(changes.newSalary)
        : null;
      if (salaryValue !== null && Number.isFinite(salaryValue) && salaryValue > 0) {
        const current = await tx.remuneration.findFirst({
          where: { employeeId: action.employeeId, deletedAt: null },
          orderBy: { effectiveFrom: 'desc' }
        });
        const currentSalary = current ? Number(current.baseSalary) : null;
        if (currentSalary === null || currentSalary !== salaryValue) {
          const effectiveFrom = new Date(changes.effectivePayrollDate || action.effectiveDate);
          if (current?.status === 'ACTIVE') {
            await tx.remuneration.update({
              where: { id: current.id },
              data: {
                status: 'INACTIVE',
                effectiveTo: effectiveFrom
              }
            });
          }
          const createdSalary = await tx.remuneration.create({
            data: {
              employeeId: action.employeeId,
              baseSalary: salaryValue,
              allowances: {},
              deductions: {},
              netSalary: salaryValue,
              currency: current?.currency || 'KES',
              effectiveFrom,
              status: 'ACTIVE'
            }
          });
          await auditService.log({
            actorId: context.actorId,
            action: AUDIT_ACTIONS.PAYROLL_UPDATED,
            entityType: 'Remuneration',
            entityId: createdSalary.id,
            oldValues: { baseSalary: currentSalary },
            newValues: {
              baseSalary: salaryValue,
              salaryChangeType: changes.salaryChangeType || null,
              effectivePayrollDate: changes.effectivePayrollDate || action.effectiveDate
            },
            req: context.req
          }, tx);
        }
      }

      const updated = await tx.hRAction.update({ where: { id: entityId }, data: { status: 'APPROVED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'HRAction', entityId, oldStatus: action.status, newStatus: 'APPROVED', action: AUDIT_ACTIONS.USER_UPDATED });
      return updated;
    }

    if (type === 'SEPARATION') {
      const separation = await tx.separation.findUnique({ where: { id: entityId } });
      if (!separation) return null;
      const exitDate = startOfDay(new Date(separation.exitDate));
      const today = startOfDay(new Date());
      if (exitDate <= today) {
        const employmentStatus = separation.type === 'RESIGNATION'
          ? 'RESIGNED'
          : separation.type === 'TERMINATION'
            ? 'TERMINATED'
            : 'INACTIVE';
        await tx.user.update({ where: { id: separation.employeeId }, data: { employmentStatus, isActive: false } });
      } else {
        await auditService.log({
          actorId: context.actorId,
          action: AUDIT_ACTIONS.USER_UPDATED,
          entityType: 'Separation',
          entityId,
          oldValues: { deferredUntil: null },
          newValues: { deferredUntil: separation.exitDate, note: 'Employee remains active until exit date.' },
          req: context.req
        }, tx);
      }
      const updated = await tx.separation.update({ where: { id: entityId }, data: { status: 'APPROVED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Separation', entityId, oldStatus: separation.status, newStatus: 'APPROVED', action: AUDIT_ACTIONS.USER_UPDATED });
      return updated;
    }

    if (type === 'CUSTOMER_ONBOARDING') {
      const existing = await tx.customerOnboarding.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.customerOnboarding.update({ where: { id: entityId }, data: { status: 'APPROVED', lockedAt: new Date(), rejectionReason: null } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'CustomerOnboarding', entityId, oldStatus: existing.status, newStatus: 'APPROVED' });
      if (updated.assignedOfficerId) {
        await notificationService.create({ userId: updated.assignedOfficerId, type: 'SYSTEM', title: 'Customer onboarding approved', body: updated.businessName, entityType: 'CustomerOnboarding', entityId }, tx);
      }
      return updated;
    }

    if (type === 'REQUISITION') {
      const existing = await tx.requisition.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.requisition.update({ where: { id: entityId }, data: { status: 'APPROVED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Requisition', entityId, oldStatus: existing.status, newStatus: 'APPROVED' });
      return updated;
    }

    if (type === 'PAYSLIP') {
      const existing = await tx.payslip.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.payslip.update({ where: { id: entityId }, data: { approvalStatus: 'APPROVED', lockedAt: new Date() } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Payslip', entityId, oldStatus: existing.approvalStatus, newStatus: 'APPROVED', extra: { lockedAt: new Date() }, action: AUDIT_ACTIONS.PAYROLL_UPDATED });
      await notificationService.create({ userId: updated.employeeId, type: 'SYSTEM', title: 'Payroll approved', body: `${updated.month}/${updated.year} payslip approved`, entityType: 'Payslip', entityId }, tx);
      return updated;
    }

    if (type === 'COMPLIANCE_ITEM') {
      const existing = await tx.complianceItem.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.complianceItem.update({ where: { id: entityId }, data: { status: 'COMPLETED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'ComplianceItem', entityId, oldStatus: existing.status, newStatus: 'COMPLETED' });
      if (updated.ownerId) {
        await notificationService.create({ userId: updated.ownerId, type: 'SYSTEM', title: 'Compliance item approved', body: updated.title, entityType: 'ComplianceItem', entityId }, tx);
      }
      return updated;
    }

    if (type === 'INCIDENT') {
      const existing = await tx.incidentReport.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.incidentReport.update({ where: { id: entityId }, data: { status: 'CLOSED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'IncidentReport', entityId, oldStatus: existing.status, newStatus: 'CLOSED' });
      if (updated.reportedById) {
        await notificationService.create({ userId: updated.reportedById, type: 'SYSTEM', title: 'Incident closure approved', body: updated.title, entityType: 'IncidentReport', entityId }, tx);
      }
      return updated;
    }

    if (type === 'RISK') {
      const existing = await tx.riskRegister.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.riskRegister.update({ where: { id: entityId }, data: { status: 'CLOSED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'RiskRegister', entityId, oldStatus: existing.status, newStatus: 'CLOSED' });
      if (updated.ownerId) {
        await notificationService.create({ userId: updated.ownerId, type: 'SYSTEM', title: 'Risk closure approved', body: updated.title, entityType: 'RiskRegister', entityId }, tx);
      }
      return updated;
    }

    if (type === 'DISCOUNT_REQUEST') {
      const existing = await tx.discountRequest.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.discountRequest.update({ where: { id: entityId }, data: { status: 'APPROVED' } });
      await auditStatusChange({
        tx,
        actorId: context.actorId,
        req: context.req,
        entityType: 'DiscountRequest',
        entityId,
        oldStatus: existing.status,
        newStatus: 'APPROVED'
      });
      if (updated.requestedById) {
        await notificationService.create({ userId: updated.requestedById, type: 'SYSTEM', title: 'Discount request approved', body: updated.reason, entityType: 'DiscountRequest', entityId }, tx);
      }
      return updated;
    }

    if (type === 'CUSTOMER_ISSUE') {
      const existing = await tx.customerIssue.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.customerIssue.update({ where: { id: entityId }, data: { status: 'CLOSED' } });
      await auditStatusChange({
        tx,
        actorId: context.actorId,
        req: context.req,
        entityType: 'CustomerIssue',
        entityId,
        oldStatus: existing.status,
        newStatus: 'CLOSED'
      });
      const recipients = [updated.reportedById, updated.assignedToId].filter(Boolean);
      if (recipients.length) {
        await notificationService.createMany(recipients, {
          type: 'SYSTEM',
          title: 'Customer issue closure approved',
          body: updated.title,
          entityType: 'CustomerIssue',
          entityId
        }, tx);
      }
      return updated;
    }

    return null;
  },

  async onApprovalRejected(entityType, entityId, context = {}, tx = prisma) {
    const type = String(entityType || '').toUpperCase();
    if (type === 'LEAVE_REQUEST') {
      const leave = await tx.leaveRequest.findUnique({ where: { id: entityId } });
      if (!leave) return null;
      const balance = await tx.leaveBalance.findUnique({
        where: {
          employeeId_leaveType_year: {
            employeeId: leave.employeeId,
            leaveType: leave.leaveType,
            year: new Date(leave.startDate).getFullYear()
          }
        }
      });
      if (balance) {
        await tx.leaveBalance.update({ where: { id: balance.id }, data: { pending: { decrement: leave.days } } });
      }
      await tx.leaveRequest.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await notificationService.create({ userId: leave.employeeId, type: 'LEAVE_STATUS_CHANGED', title: 'Leave rejected', body: 'Your leave request has been rejected.', entityType: 'LeaveRequest', entityId }, tx);
      return leave;
    }
    if (type === 'FINANCE_REQUEST') {
      const existing = await tx.financeRequest.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.financeRequest.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'FinanceRequest', entityId, oldStatus: existing.status, newStatus: 'REJECTED', action: AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED });
      await notificationService.create({ userId: updated.requestedById, type: 'EXPENSE_STATUS_CHANGED', title: updated.title, body: 'Finance request rejected', entityType: 'FinanceRequest', entityId }, tx);
      return updated;
    }
    if (type === 'HR_ACTION') {
      const existing = await tx.hRAction.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.hRAction.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'HRAction', entityId, oldStatus: existing.status, newStatus: 'REJECTED', action: AUDIT_ACTIONS.USER_UPDATED });
      return updated;
    }
    if (type === 'SEPARATION') {
      const existing = await tx.separation.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.separation.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Separation', entityId, oldStatus: existing.status, newStatus: 'REJECTED', action: AUDIT_ACTIONS.USER_UPDATED });
      return updated;
    }
    if (type === 'DOCUMENT') {
      const existing = await tx.document.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.document.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Document', entityId, oldStatus: existing.status, newStatus: 'REJECTED', action: AUDIT_ACTIONS.DOCUMENT_REJECTED });
      if (updated.uploadedById && updated.uploadedById !== context.actorId) {
        await notificationService.create({ userId: updated.uploadedById, type: 'DOCUMENT_UPLOADED', title: 'Document rejected', body: updated.title, entityType: 'Document', entityId }, tx);
      }
      return updated;
    }
    if (type === 'CUSTOMER_ONBOARDING') {
      const existing = await tx.customerOnboarding.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const rejectionReason = context.req?.body?.comment || null;
      const updated = await tx.customerOnboarding.update({ where: { id: entityId }, data: { status: 'REJECTED', rejectionReason } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'CustomerOnboarding', entityId, oldStatus: existing.status, newStatus: 'REJECTED', extra: { rejectionReason } });
      if (updated.assignedOfficerId) {
        await notificationService.create({ userId: updated.assignedOfficerId, type: 'SYSTEM', title: 'Customer onboarding rejected', body: updated.businessName, entityType: 'CustomerOnboarding', entityId }, tx);
      }
      return updated;
    }
    if (type === 'REQUISITION') {
      const existing = await tx.requisition.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.requisition.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Requisition', entityId, oldStatus: existing.status, newStatus: 'REJECTED' });
      return updated;
    }
    if (type === 'PAYSLIP') {
      const existing = await tx.payslip.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.payslip.update({ where: { id: entityId }, data: { approvalStatus: 'REJECTED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'Payslip', entityId, oldStatus: existing.approvalStatus, newStatus: 'REJECTED', extra: { rejectionReason: context.req?.body?.comment || null }, action: AUDIT_ACTIONS.PAYROLL_UPDATED });
      await notificationService.create({ userId: updated.employeeId, type: 'SYSTEM', title: 'Payroll rejected', body: `${updated.month}/${updated.year} payslip rejected`, entityType: 'Payslip', entityId }, tx);
      if (updated.generatedById && updated.generatedById !== updated.employeeId) {
        await notificationService.create({ userId: updated.generatedById, type: 'SYSTEM', title: 'Payroll rejected', body: `${updated.month}/${updated.year} payslip requires changes`, entityType: 'Payslip', entityId }, tx);
      }
      return updated;
    }
    if (type === 'COMPLIANCE_ITEM') {
      const existing = await tx.complianceItem.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.complianceItem.update({ where: { id: entityId }, data: { status: 'IN_PROGRESS' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'ComplianceItem', entityId, oldStatus: existing.status, newStatus: 'IN_PROGRESS' });
      if (updated.ownerId) {
        await notificationService.create({ userId: updated.ownerId, type: 'SYSTEM', title: 'Compliance item approval rejected', body: updated.title, entityType: 'ComplianceItem', entityId }, tx);
      }
      return updated;
    }
    if (type === 'INCIDENT') {
      const existing = await tx.incidentReport.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.incidentReport.update({ where: { id: entityId }, data: { status: 'RESOLVED' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'IncidentReport', entityId, oldStatus: existing.status, newStatus: 'RESOLVED' });
      if (updated.reportedById) {
        await notificationService.create({ userId: updated.reportedById, type: 'SYSTEM', title: 'Incident closure rejected', body: updated.title, entityType: 'IncidentReport', entityId }, tx);
      }
      return updated;
    }
    if (type === 'RISK') {
      const existing = await tx.riskRegister.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.riskRegister.update({ where: { id: entityId }, data: { status: 'IN_PROGRESS' } });
      await auditStatusChange({ tx, actorId: context.actorId, req: context.req, entityType: 'RiskRegister', entityId, oldStatus: existing.status, newStatus: 'IN_PROGRESS' });
      if (updated.ownerId) {
        await notificationService.create({ userId: updated.ownerId, type: 'SYSTEM', title: 'Risk closure rejected', body: updated.title, entityType: 'RiskRegister', entityId }, tx);
      }
      return updated;
    }
    if (type === 'DISCOUNT_REQUEST') {
      const existing = await tx.discountRequest.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.discountRequest.update({ where: { id: entityId }, data: { status: 'REJECTED' } });
      await auditStatusChange({
        tx,
        actorId: context.actorId,
        req: context.req,
        entityType: 'DiscountRequest',
        entityId,
        oldStatus: existing.status,
        newStatus: 'REJECTED'
      });
      if (updated.requestedById) {
        await notificationService.create({ userId: updated.requestedById, type: 'SYSTEM', title: 'Discount request rejected', body: updated.reason, entityType: 'DiscountRequest', entityId }, tx);
      }
      return updated;
    }
    if (type === 'CUSTOMER_ISSUE') {
      const existing = await tx.customerIssue.findUnique({ where: { id: entityId } });
      if (!existing) return null;
      const updated = await tx.customerIssue.update({ where: { id: entityId }, data: { status: 'RESOLVED' } });
      await auditStatusChange({
        tx,
        actorId: context.actorId,
        req: context.req,
        entityType: 'CustomerIssue',
        entityId,
        oldStatus: existing.status,
        newStatus: 'RESOLVED'
      });
      const recipients = [updated.reportedById, updated.assignedToId].filter(Boolean);
      if (recipients.length) {
        await notificationService.createMany(recipients, {
          type: 'SYSTEM',
          title: 'Customer issue closure rejected',
          body: updated.title,
          entityType: 'CustomerIssue',
          entityId
        }, tx);
      }
      return updated;
    }
    return null;
  }
};

module.exports = workflowOrchestratorService;
