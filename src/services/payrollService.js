const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const auditService = require('./auditService');
const approvalService = require('./approvalService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const domainGuardService = require('./domainGuardService');
const stateMachineService = require('./stateMachineService');
const timelineService = require('./timelineService');
const approvalPolicyService = require('./approvalPolicyService');

const sumItems = (items) => (Array.isArray(items) ? items.reduce((sum, item) => sum + Number(item.amount || 0), 0) : 0);

const payrollService = {
  async listRemunerations(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      where.employeeId = auth.userId;
    }
    const [items, total] = await prisma.$transaction([
      prisma.remuneration.findMany({ where, include: { employee: { select: { id: true, fullName: true, departmentId: true } } }, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.remuneration.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async createRemuneration(auth, data, req) {
    domainGuardService.cannotViewUnauthorizedSalary(auth, data.employeeId);
    const netSalary = Number(data.baseSalary) + sumItems(data.allowances) - sumItems(data.deductions);
    const remuneration = await prisma.$transaction(async (tx) => {
      await tx.remuneration.updateMany({
        where: { employeeId: data.employeeId, deletedAt: null, status: 'ACTIVE' },
        data: { status: 'INACTIVE', effectiveTo: new Date(data.effectiveFrom) }
      });
      const created = await tx.remuneration.create({
        data: {
          employeeId: data.employeeId,
          baseSalary: data.baseSalary,
          allowances: data.allowances,
          deductions: data.deductions,
          netSalary,
          currency: data.currency || 'KES',
          effectiveFrom: data.effectiveFrom,
          effectiveTo: data.effectiveTo
        }
      });
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.PAYROLL_UPDATED, entityType: 'Remuneration', entityId: created.id, newValues: created, req }, tx);
      return created;
    });
    return remuneration;
  },

  async listPayslips(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = { deletedAt: null };
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.approvalStatus) where.approvalStatus = query.approvalStatus;
    if (query.month) where.month = Number(query.month);
    if (query.year) where.year = Number(query.year);
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      where.employeeId = auth.userId;
    }
    const [items, total] = await prisma.$transaction([
      prisma.payslip.findMany({ where, include: { employee: { select: { id: true, fullName: true } }, generatedBy: { select: { id: true, fullName: true } } }, skip, take: limit, orderBy: { [sortBy]: sortOrder } }),
      prisma.payslip.count({ where })
    ]);
    return paginated(items, total, page, limit);
  },

  async getPayslip(auth, id) {
    const payslip = await prisma.payslip.findFirst({
      where: { id, deletedAt: null },
      include: {
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true,
            department: { select: { id: true, name: true, slug: true } }
          }
        },
        generatedBy: {
          select: {
            id: true,
            fullName: true,
            email: true
          }
        }
      }
    });

    if (!payslip) throw new AppError('Payslip not found', 404);
    domainGuardService.cannotViewUnauthorizedSalary(auth, payslip.employeeId);

    const [approvalRequest, timeline] = await Promise.all([
      prisma.approvalRequest.findFirst({
        where: { entityType: 'PAYSLIP', entityId: id },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          currentApprover: { select: { id: true, fullName: true, email: true } },
          steps: true,
          comments: {
            where: { deletedAt: null },
            include: { author: { select: { id: true, fullName: true } } },
            orderBy: { createdAt: 'desc' },
            take: 20
          }
        }
      }),
      timelineService.getTimeline('PAYSLIP', id)
    ]);

    return {
      ...payslip,
      approvalRequest,
      timeline
    };
  },

  async generatePayslip(auth, data, req) {
    domainGuardService.cannotViewUnauthorizedSalary(auth, data.employeeId);
    const existing = await prisma.payslip.findUnique({ where: { employeeId_month_year: { employeeId: data.employeeId, month: data.month, year: data.year } } });
    if (existing && !existing.deletedAt) throw new AppError('Payslip already exists for this employee and month', 400);
    const remuneration = await prisma.remuneration.findFirst({
      where: {
        employeeId: data.employeeId,
        deletedAt: null,
        status: 'ACTIVE',
        effectiveFrom: { lte: new Date(data.year, data.month - 1, 31) },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(data.year, data.month - 1, 1) } }]
      },
      orderBy: { effectiveFrom: 'desc' }
    });
    if (!remuneration) throw new AppError('No active remuneration profile found for this employee', 400);
    const grossPay = Number(remuneration.baseSalary) + sumItems(remuneration.allowances);
    const totalDeductions = sumItems(remuneration.deductions);
    const netPay = grossPay - totalDeductions;
    const steps = await approvalPolicyService.buildPayrollSteps({ requesterRoleName: auth.roleName });
    if (!steps.length) throw new AppError('Payroll approval workflow could not resolve a valid approver', 400);
    const payslip = await prisma.$transaction(async (tx) => {
      const created = await tx.payslip.create({
        data: {
          employeeId: data.employeeId,
          month: data.month,
          year: data.year,
          grossPay,
          totalDeductions,
          netPay,
          generatedById: auth.userId
        }
      });
      await approvalService.create({
        requestType: 'PAYROLL',
        entityType: 'PAYSLIP',
        entityId: created.id,
        requestedById: auth.userId,
        steps,
        reason: `Payroll approval for ${data.month}/${data.year}`,
        tx
      }, auth.userId, req);
      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.PAYROLL_UPDATED, entityType: 'Payslip', entityId: created.id, newValues: created, req }, tx);
      return created;
    });
    await notificationService.create({ userId: data.employeeId, type: 'SYSTEM', title: 'New payslip generated', body: `${data.month}/${data.year}`, entityType: 'Payslip', entityId: payslip.id });
    return payslip;
  },

  async decidePayslip(auth, id, decision, comment, req) {
    const payslip = await prisma.payslip.findFirst({ where: { id, deletedAt: null } });
    if (!payslip) throw new AppError('Payslip not found', 404);
    const approvalRequest = await approvalService.getOpenByEntity('PAYSLIP', id);
    if (!approvalRequest) throw new AppError('Payslip is missing its approval workflow', 400);
    await approvalService.act(approvalRequest.id, decision, auth.userId, comment, req);
    return prisma.payslip.findUnique({ where: { id } });
  },

  async summary(auth, query = {}) {
    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isFinance(auth)) {
      throw new AppError('You do not have access to payroll summary data', 403);
    }
    const where = { deletedAt: null };
    if (query.month) where.month = Number(query.month);
    if (query.year) where.year = Number(query.year);
    const [totals, byApprovalStatus, byDepartment] = await prisma.$transaction([
      prisma.payslip.aggregate({ where, _sum: { grossPay: true, totalDeductions: true, netPay: true }, _count: true }),
      prisma.payslip.groupBy({ by: ['approvalStatus'], where, _count: true }),
      prisma.payslip.findMany({ where, include: { employee: { select: { departmentId: true } } } })
    ]);
    const departmentSummary = byDepartment.reduce((acc, payslip) => {
      const key = payslip.employee?.departmentId || 'UNASSIGNED';
      acc[key] = (acc[key] || 0) + Number(payslip.netPay);
      return acc;
    }, {});
    return { totals, byApprovalStatus, departmentSummary };
  }
};

module.exports = payrollService;
