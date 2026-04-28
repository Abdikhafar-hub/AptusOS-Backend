const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const domainGuardService = require('./domainGuardService');
const auditService = require('./auditService');
const exportService = require('./exportService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const CYCLE_STATUSES = Object.freeze({
  DRAFT: 'DRAFT',
  PROCESSING: 'PROCESSING',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  APPROVED: 'APPROVED',
  PAID: 'PAID'
});

function parseScaled(value, scale) {
  const raw = String(value ?? '0').trim();
  if (!raw) return 0n;
  const negative = raw.startsWith('-');
  const normalized = negative ? raw.slice(1) : raw;
  if (!/^\d+(\.\d+)?$/.test(normalized)) throw new AppError(`Invalid numeric value: ${value}`, 400);
  const [intPart, fracPart = ''] = normalized.split('.');
  const paddedFrac = fracPart.padEnd(scale, '0').slice(0, scale);
  const combined = `${intPart}${paddedFrac}`.replace(/^0+(?=\d)/, '');
  const parsed = BigInt(combined || '0');
  return negative ? -parsed : parsed;
}

function amountToCents(value) {
  return parseScaled(value, 2);
}

function centsToAmountString(cents) {
  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const asString = absolute.toString().padStart(3, '0');
  const integer = asString.slice(0, -2) || '0';
  const fraction = asString.slice(-2);
  return `${negative ? '-' : ''}${integer}.${fraction}`;
}

function centsToNumber(cents) {
  return Number(centsToAmountString(cents));
}

function divideRoundHalfUp(numerator, denominator) {
  if (denominator === 0n) throw new AppError('Invalid payroll calculation denominator', 500);
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const shouldRound = remainder * 2n >= denominator;
  const rounded = shouldRound ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

function percentageOf(baseCents, percentageValue) {
  const scaledPercent = parseScaled(percentageValue, 4);
  const denominator = 1000000n; // 100 * 10^4
  return divideRoundHalfUp(baseCents * scaledPercent, denominator);
}

function periodRange(month, year) {
  const monthNumber = Number(month);
  const yearNumber = Number(year);
  if (!Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) throw new AppError('Invalid payroll month', 400);
  if (!Number.isInteger(yearNumber) || yearNumber < 2000 || yearNumber > 3000) throw new AppError('Invalid payroll year', 400);
  const startDate = new Date(Date.UTC(yearNumber, monthNumber - 1, 1, 0, 0, 0, 0));
  const endDate = new Date(Date.UTC(yearNumber, monthNumber, 0, 23, 59, 59, 999));
  return { startDate, endDate, month: monthNumber, year: yearNumber };
}

function isActiveForPeriod(record, startDate, endDate) {
  const from = new Date(record.effectiveFrom);
  const to = record.effectiveTo ? new Date(record.effectiveTo) : null;
  return from <= endDate && (!to || to >= startDate);
}

function isEditableCycle(status) {
  return [CYCLE_STATUSES.DRAFT, CYCLE_STATUSES.PROCESSING, CYCLE_STATUSES.PENDING_APPROVAL].includes(status);
}

function escapePdfText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function createBasicPdf(lines) {
  const safeLines = Array.isArray(lines) ? lines : [];
  const contentLines = ['BT', '/F1 11 Tf', '50 790 Td'];

  safeLines.forEach((line, index) => {
    if (index > 0) contentLines.push('0 -14 Td');
    contentLines.push(`(${escapePdfText(line)}) Tj`);
  });

  contentLines.push('ET');
  const contentStream = contentLines.join('\n');

  const objects = [];
  objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  objects.push('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  objects.push('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  objects.push(`5 0 obj\n<< /Length ${Buffer.byteLength(contentStream, 'utf8')} >>\nstream\n${contentStream}\nendstream\nendobj\n`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((obj) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += obj;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 1; i <= objects.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'utf8');
}

function ruleAppliesToEmployee(rule, employee) {
  if (rule.employeeId && rule.employeeId !== employee.id) return false;
  if (rule.departmentId && employee.departmentId !== rule.departmentId) return false;
  return true;
}

function buildProgressiveTaxCents(taxableIncomeCents, brackets) {
  if (!Array.isArray(brackets) || !brackets.length) return 0n;
  let total = 0n;
  let previousUpper = 0n;

  for (const bracket of brackets) {
    const hasUpperBound = bracket && bracket.upTo !== null && bracket.upTo !== undefined && bracket.upTo !== '';
    const upperBound = hasUpperBound ? amountToCents(bracket.upTo) : null;
    const rate = bracket?.rate ?? 0;

    if (upperBound !== null && upperBound < previousUpper) {
      throw new AppError('Tax brackets are inconsistent: upTo values must be ascending', 400);
    }

    const segmentUpper = upperBound === null ? taxableIncomeCents : (upperBound < taxableIncomeCents ? upperBound : taxableIncomeCents);
    if (segmentUpper <= previousUpper) {
      if (upperBound !== null) previousUpper = upperBound;
      continue;
    }

    const segmentTaxable = segmentUpper - previousUpper;
    total += percentageOf(segmentTaxable, rate);

    if (upperBound === null || upperBound >= taxableIncomeCents) {
      break;
    }

    previousUpper = upperBound;
  }

  return total;
}

function calculatePayrollRecord({
  employee,
  compensation,
  allowances,
  deductions,
  statutoryRules,
  cycle
}) {
  const baseSalaryCents = amountToCents(compensation.baseSalary);
  const currency = compensation.currency || cycle.currency || 'KES';

  const earningLineItems = [
    {
      type: 'EARNING',
      sourceType: 'BASE_SALARY',
      name: 'Base Salary',
      amountCents: baseSalaryCents,
      taxable: true,
      calculationReference: {
        source: 'EmployeeCompensation',
        compensationId: compensation.id
      }
    }
  ];

  for (const allowance of allowances) {
    const amountCents = allowance.type === 'PERCENTAGE'
      ? percentageOf(baseSalaryCents, allowance.amount)
      : amountToCents(allowance.amount);

    earningLineItems.push({
      type: 'EARNING',
      sourceType: 'ALLOWANCE',
      name: allowance.name,
      amountCents,
      taxable: Boolean(allowance.taxable),
      calculationReference: {
        source: 'Allowance',
        allowanceId: allowance.id,
        type: allowance.type,
        configuredAmount: String(allowance.amount)
      }
    });
  }

  const totalAllowancesCents = earningLineItems
    .filter((line) => line.sourceType === 'ALLOWANCE')
    .reduce((sum, line) => sum + line.amountCents, 0n);

  const grossPayCents = baseSalaryCents + totalAllowancesCents;
  const taxableAllowanceCents = earningLineItems
    .filter((line) => line.sourceType === 'ALLOWANCE' && line.taxable)
    .reduce((sum, line) => sum + line.amountCents, 0n);

  const taxableEarningsCents = baseSalaryCents + taxableAllowanceCents;

  const explicitDeductionLineItems = deductions.map((deduction) => {
    const referenceBase = deduction.timing === 'PRE_TAX' ? taxableEarningsCents : grossPayCents;
    const amountCents = deduction.calculationType === 'PERCENTAGE'
      ? percentageOf(referenceBase, deduction.amount)
      : amountToCents(deduction.amount);

    return {
      type: 'DEDUCTION',
      sourceType: 'DEDUCTION',
      name: deduction.name,
      amountCents,
      timing: deduction.timing,
      calculationReference: {
        source: 'Deduction',
        deductionId: deduction.id,
        category: deduction.category,
        calculationType: deduction.calculationType,
        configuredAmount: String(deduction.amount),
        calculationBase: deduction.calculationType === 'PERCENTAGE' ? (deduction.timing === 'PRE_TAX' ? 'TAXABLE_EARNINGS' : 'GROSS_PAY') : 'FIXED'
      }
    };
  });

  const preTaxDeductionCents = explicitDeductionLineItems
    .filter((line) => line.timing === 'PRE_TAX')
    .reduce((sum, line) => sum + line.amountCents, 0n);

  const taxableIncomeCentsRaw = taxableEarningsCents - preTaxDeductionCents;
  const taxableIncomeCents = taxableIncomeCentsRaw > 0n ? taxableIncomeCentsRaw : 0n;

  const statutoryLineItems = [];
  for (const rule of statutoryRules) {
    let amountCents = 0n;

    if (rule.ruleType === 'FIXED') {
      const configuredAmount = rule?.config?.amount ?? rule?.config?.value;
      amountCents = amountToCents(configuredAmount || 0);
    } else if (rule.ruleType === 'PERCENTAGE') {
      const rate = rule?.config?.rate ?? rule?.config?.percentage ?? 0;
      amountCents = percentageOf(taxableIncomeCents, rate);
    } else if (rule.ruleType === 'TAX_BRACKETS') {
      amountCents = buildProgressiveTaxCents(taxableIncomeCents, rule?.config?.brackets || []);
    }

    statutoryLineItems.push({
      type: 'DEDUCTION',
      sourceType: 'STATUTORY',
      name: rule.name,
      amountCents,
      timing: 'POST_TAX',
      calculationReference: {
        source: 'PayrollStatutoryRule',
        ruleId: rule.id,
        ruleType: rule.ruleType,
        config: rule.config
      }
    });
  }

  const postTaxExplicitDeductionCents = explicitDeductionLineItems
    .filter((line) => line.timing === 'POST_TAX')
    .reduce((sum, line) => sum + line.amountCents, 0n);

  const statutoryDeductionCents = statutoryLineItems.reduce((sum, line) => sum + line.amountCents, 0n);
  const totalDeductionsCents = preTaxDeductionCents + postTaxExplicitDeductionCents + statutoryDeductionCents;
  const netPayCents = grossPayCents - totalDeductionsCents;

  const lineItems = [...earningLineItems, ...explicitDeductionLineItems, ...statutoryLineItems]
    .map((line) => ({
      type: line.type,
      sourceType: line.sourceType,
      name: line.name,
      amount: centsToAmountString(line.amountCents),
      amountCents: line.amountCents,
      calculationReference: line.calculationReference
    }))
    .sort((left, right) => (left.type === right.type ? 0 : left.type === 'EARNING' ? -1 : 1));

  const hasAnomaly = netPayCents < 0n;

  return {
    employeeId: employee.id,
    compensationId: compensation.id,
    baseSalary: centsToAmountString(baseSalaryCents),
    grossPay: centsToAmountString(grossPayCents),
    totalAllowances: centsToAmountString(totalAllowancesCents),
    taxableIncome: centsToAmountString(taxableIncomeCents),
    totalDeductions: centsToAmountString(totalDeductionsCents),
    netPay: centsToAmountString(netPayCents),
    currency,
    status: hasAnomaly ? 'FLAGGED' : 'CALCULATED',
    hasAnomaly,
    anomalyReason: hasAnomaly ? 'Negative net pay generated' : null,
    lineItems,
    totalsCents: {
      grossPayCents,
      netPayCents,
      totalDeductionsCents,
      totalAllowancesCents
    }
  };
}

async function createPayrollAuditLog(tx, { cycleId = null, recordId = null, action, performedById, payloadBefore = null, payloadAfter = null }) {
  await tx.payrollAuditLog.create({
    data: {
      payrollCycleId: cycleId,
      payrollRecordId: recordId,
      action,
      performedById,
      payloadBefore,
      payloadAfter
    }
  });
}

async function buildCycleSnapshot(tx, cycleId) {
  const cycle = await tx.payrollCycle.findFirst({
    where: { id: cycleId, deletedAt: null },
    include: {
      createdBy: { select: { id: true, fullName: true, email: true } },
      approvedBy: { select: { id: true, fullName: true, email: true } },
      _count: { select: { records: true } }
    }
  });

  if (!cycle) throw new AppError('Payroll cycle not found', 404);

  const aggregate = await tx.payrollRecord.aggregate({
    where: { payrollCycleId: cycle.id, deletedAt: null },
    _sum: {
      grossPay: true,
      netPay: true,
      totalDeductions: true,
      totalAllowances: true
    },
    _count: true
  });

  const pendingApprovals = await tx.payrollRecord.count({
    where: {
      payrollCycleId: cycle.id,
      deletedAt: null,
      status: { in: ['CALCULATED', 'FLAGGED'] }
    }
  });

  return {
    ...cycle,
    totals: {
      totalPayrollCost: aggregate._sum.grossPay || 0,
      totalNetPay: aggregate._sum.netPay || 0,
      totalDeductions: aggregate._sum.totalDeductions || 0,
      totalAllowances: aggregate._sum.totalAllowances || 0,
      employeeCount: aggregate._count || 0,
      pendingApprovals
    }
  };
}

const payrollService = {
  async createCycle(auth, data, req) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only Finance or General Manager can create payroll cycles', 403);
    }

    const range = periodRange(data.periodMonth, data.periodYear);
    const existing = await prisma.payrollCycle.findFirst({
      where: {
        periodMonth: range.month,
        periodYear: range.year,
        deletedAt: null
      }
    });

    if (existing) throw new AppError('Payroll cycle already exists for this month/year', 409);

    const cycle = await prisma.payrollCycle.create({
      data: {
        periodMonth: range.month,
        periodYear: range.year,
        startDate: data.startDate || range.startDate,
        endDate: data.endDate || range.endDate,
        status: 'DRAFT',
        currency: data.currency || 'KES',
        notes: data.notes || null,
        createdById: auth.userId
      }
    });

    await createPayrollAuditLog(prisma, {
      cycleId: cycle.id,
      action: 'PAYROLL_CYCLE_CREATED',
      performedById: auth.userId,
      payloadAfter: cycle
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.PAYROLL_CYCLE_CREATED,
      entityType: 'PayrollCycle',
      entityId: cycle.id,
      newValues: cycle,
      req
    });

    return cycle;
  },

  async listCycles(auth, query = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where = { deletedAt: null };

    if (query.periodMonth) where.periodMonth = Number(query.periodMonth);
    if (query.periodYear) where.periodYear = Number(query.periodYear);
    if (query.status) where.status = query.status;

    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      where.records = {
        some: {
          employeeId: auth.userId,
          deletedAt: null
        }
      };
    }

    const [cycles, total] = await prisma.$transaction([
      prisma.payrollCycle.findMany({
        where,
        include: {
          createdBy: { select: { id: true, fullName: true } },
          approvedBy: { select: { id: true, fullName: true } },
          _count: { select: { records: true } }
        },
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit
      }),
      prisma.payrollCycle.count({ where })
    ]);

    const cycleIds = cycles.map((cycle) => cycle.id);
    const aggregates = cycleIds.length
      ? await prisma.payrollRecord.groupBy({
        by: ['payrollCycleId'],
        where: { payrollCycleId: { in: cycleIds }, deletedAt: null },
        _sum: {
          grossPay: true,
          netPay: true,
          totalDeductions: true
        },
        _count: true
      })
      : [];

    const aggregateMap = new Map(aggregates.map((item) => [item.payrollCycleId, item]));

    const enriched = cycles.map((cycle) => {
      const aggregate = aggregateMap.get(cycle.id);
      return {
        ...cycle,
        totals: {
          totalPayrollCost: aggregate?._sum?.grossPay || 0,
          totalNetPay: aggregate?._sum?.netPay || 0,
          totalDeductions: aggregate?._sum?.totalDeductions || 0,
          employeeCount: aggregate?._count || 0
        }
      };
    });

    return paginated(enriched, total, page, limit);
  },

  async getCycle(auth, cycleId) {
    const cycle = await prisma.payrollCycle.findFirst({ where: { id: cycleId, deletedAt: null } });
    if (!cycle) throw new AppError('Payroll cycle not found', 404);

    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      const hasAccess = await prisma.payrollRecord.findFirst({
        where: { payrollCycleId: cycleId, employeeId: auth.userId, deletedAt: null },
        select: { id: true }
      });
      if (!hasAccess) throw new AppError('You do not have access to this payroll cycle', 403);
    }

    return buildCycleSnapshot(prisma, cycleId);
  },

  async runPayroll(auth, data, req) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only Finance or General Manager can run payroll', 403);
    }

    const range = periodRange(data.periodMonth, data.periodYear);

    let cycle = await prisma.payrollCycle.findFirst({
      where: { periodMonth: range.month, periodYear: range.year, deletedAt: null }
    });

    if (!cycle) {
      cycle = await prisma.payrollCycle.create({
        data: {
          periodMonth: range.month,
          periodYear: range.year,
          startDate: data.startDate || range.startDate,
          endDate: data.endDate || range.endDate,
          status: 'DRAFT',
          createdById: auth.userId,
          currency: data.currency || 'KES'
        }
      });
    }

    const existingRecords = await prisma.payrollRecord.count({ where: { payrollCycleId: cycle.id, deletedAt: null } });
    if (existingRecords > 0 || cycle.status !== CYCLE_STATUSES.DRAFT) {
      throw new AppError('Payroll cycle already processed. Use reset or recalculate explicitly before rerun.', 400);
    }

    return this.executeCycleCalculation(auth, cycle.id, 'PAYROLL_RUN', req);
  },

  async recalculateCycle(auth, cycleId, req) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only Finance or General Manager can recalculate payroll', 403);
    }

    const cycle = await prisma.payrollCycle.findFirst({ where: { id: cycleId, deletedAt: null } });
    if (!cycle) throw new AppError('Payroll cycle not found', 404);
    if (!isEditableCycle(cycle.status)) throw new AppError('Cannot recalculate cycle after approval or payment', 400);

    return this.executeCycleCalculation(auth, cycle.id, 'PAYROLL_RECALCULATED', req, { resetExisting: true });
  },

  async resetCycle(auth, cycleId, req) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only Finance or General Manager can reset payroll cycle', 403);
    }

    const cycle = await prisma.payrollCycle.findFirst({ where: { id: cycleId, deletedAt: null } });
    if (!cycle) throw new AppError('Payroll cycle not found', 404);
    if (!isEditableCycle(cycle.status)) throw new AppError('Cannot reset cycle after approval or payment', 400);

    const result = await prisma.$transaction(async (tx) => {
      const before = await buildCycleSnapshot(tx, cycleId);
      await tx.payrollLineItem.deleteMany({ where: { record: { payrollCycleId: cycleId } } });
      await tx.payrollRecord.deleteMany({ where: { payrollCycleId: cycleId } });
      const updated = await tx.payrollCycle.update({ where: { id: cycleId }, data: { status: 'DRAFT', approvedAt: null, approvedById: null, paidAt: null, lockedAt: null } });

      await createPayrollAuditLog(tx, {
        cycleId,
        action: 'PAYROLL_RESET',
        performedById: auth.userId,
        payloadBefore: before,
        payloadAfter: updated
      });

      return buildCycleSnapshot(tx, cycleId);
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.PAYROLL_RESET,
      entityType: 'PayrollCycle',
      entityId: cycleId,
      newValues: { status: 'DRAFT' },
      req
    });

    return result;
  },

  async approveCycle(auth, cycleId, req) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only Finance or General Manager can approve payroll cycle', 403);
    }

    return prisma.$transaction(async (tx) => {
      const cycle = await tx.payrollCycle.findFirst({ where: { id: cycleId, deletedAt: null } });
      if (!cycle) throw new AppError('Payroll cycle not found', 404);
      if (cycle.status !== CYCLE_STATUSES.PENDING_APPROVAL) throw new AppError('Cycle must be pending approval before approval', 400);

      const recordCount = await tx.payrollRecord.count({ where: { payrollCycleId: cycleId, deletedAt: null } });
      if (!recordCount) throw new AppError('Cannot approve cycle without payroll records', 400);

      const before = await buildCycleSnapshot(tx, cycleId);
      const approvedAt = new Date();
      await tx.payrollCycle.update({
        where: { id: cycleId },
        data: {
          status: 'APPROVED',
          approvedById: auth.userId,
          approvedAt,
          lockedAt: approvedAt
        }
      });
      await tx.payrollRecord.updateMany({
        where: { payrollCycleId: cycleId, deletedAt: null },
        data: { status: 'APPROVED' }
      });

      const after = await buildCycleSnapshot(tx, cycleId);

      await createPayrollAuditLog(tx, {
        cycleId,
        action: 'PAYROLL_APPROVED',
        performedById: auth.userId,
        payloadBefore: before,
        payloadAfter: after
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.PAYROLL_APPROVED,
        entityType: 'PayrollCycle',
        entityId: cycleId,
        oldValues: before,
        newValues: after,
        req
      }, tx);

      return after;
    });
  },

  async markCyclePaid(auth, cycleId, req) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only Finance or General Manager can mark payroll as paid', 403);
    }

    return prisma.$transaction(async (tx) => {
      const cycle = await tx.payrollCycle.findFirst({ where: { id: cycleId, deletedAt: null } });
      if (!cycle) throw new AppError('Payroll cycle not found', 404);
      if (cycle.status !== CYCLE_STATUSES.APPROVED) throw new AppError('Cycle must be approved before payment', 400);

      const before = await buildCycleSnapshot(tx, cycleId);
      const paidAt = new Date();
      await tx.payrollCycle.update({
        where: { id: cycleId },
        data: {
          status: 'PAID',
          paidAt,
          lockedAt: paidAt
        }
      });
      await tx.payrollRecord.updateMany({
        where: { payrollCycleId: cycleId, deletedAt: null },
        data: { status: 'PAID' }
      });

      const after = await buildCycleSnapshot(tx, cycleId);

      await createPayrollAuditLog(tx, {
        cycleId,
        action: 'PAYROLL_MARKED_PAID',
        performedById: auth.userId,
        payloadBefore: before,
        payloadAfter: after
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.PAYROLL_PAID,
        entityType: 'PayrollCycle',
        entityId: cycleId,
        oldValues: before,
        newValues: after,
        req
      }, tx);

      return after;
    });
  },

  async executeCycleCalculation(auth, cycleId, auditAction, req, options = {}) {
    const resetExisting = Boolean(options.resetExisting);

    return prisma.$transaction(async (tx) => {
      const cycle = await tx.payrollCycle.findFirst({ where: { id: cycleId, deletedAt: null } });
      if (!cycle) throw new AppError('Payroll cycle not found', 404);
      if (!isEditableCycle(cycle.status)) throw new AppError('Cannot process cycle after approval or payment', 400);

      const before = await buildCycleSnapshot(tx, cycleId);

      await tx.payrollCycle.update({
        where: { id: cycleId },
        data: { status: 'PROCESSING' }
      });

      if (resetExisting) {
        await tx.payrollLineItem.deleteMany({ where: { record: { payrollCycleId: cycleId } } });
        await tx.payrollRecord.deleteMany({ where: { payrollCycleId: cycleId } });
      }

      const employees = await tx.user.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          employmentStatus: 'ACTIVE'
        },
        select: {
          id: true,
          fullName: true,
          departmentId: true
        }
      });

      if (!employees.length) {
        throw new AppError('No active employees found for payroll cycle', 400);
      }

      const { startDate, endDate } = cycle;

      const compensations = await tx.employeeCompensation.findMany({
        where: {
          deletedAt: null,
          employeeId: { in: employees.map((employee) => employee.id) },
          effectiveFrom: { lte: endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }]
        },
        orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'desc' }]
      });

      const compensationMap = new Map();
      compensations.forEach((compensation) => {
        if (!compensationMap.has(compensation.employeeId)) compensationMap.set(compensation.employeeId, compensation);
      });

      const missingCompensation = employees.filter((employee) => !compensationMap.has(employee.id));
      if (missingCompensation.length) {
        const preview = missingCompensation.slice(0, 5).map((employee) => employee.fullName).join(', ');
        throw new AppError(`Payroll run blocked: missing compensation profile for ${missingCompensation.length} employee(s) (${preview})`, 400);
      }

      const allowances = await tx.allowance.findMany({
        where: {
          deletedAt: null,
          effectiveFrom: { lte: endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }]
        }
      });

      const deductions = await tx.deduction.findMany({
        where: {
          deletedAt: null,
          effectiveFrom: { lte: endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }]
        }
      });

      const statutoryRules = await tx.payrollStatutoryRule.findMany({
        where: {
          deletedAt: null,
          isActive: true,
          effectiveFrom: { lte: endDate },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }]
        },
        orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }]
      });

      let totalGrossCents = 0n;
      let totalNetCents = 0n;
      let totalDeductionsCents = 0n;
      let totalAllowancesCents = 0n;
      let flaggedCount = 0;

      for (const employee of employees) {
        const compensation = compensationMap.get(employee.id);
        if (!compensation || !isActiveForPeriod(compensation, startDate, endDate)) {
          throw new AppError(`Payroll run blocked: missing active compensation for ${employee.fullName}`, 400);
        }

        const employeeAllowances = allowances.filter((item) => item.deletedAt === null && isActiveForPeriod(item, startDate, endDate) && ruleAppliesToEmployee(item, employee));
        const employeeDeductions = deductions.filter((item) => item.deletedAt === null && isActiveForPeriod(item, startDate, endDate) && ruleAppliesToEmployee(item, employee));

        const recordPayload = calculatePayrollRecord({
          employee,
          compensation,
          allowances: employeeAllowances,
          deductions: employeeDeductions,
          statutoryRules,
          cycle
        });

        if (recordPayload.hasAnomaly) flaggedCount += 1;

        totalGrossCents += recordPayload.totalsCents.grossPayCents;
        totalNetCents += recordPayload.totalsCents.netPayCents;
        totalDeductionsCents += recordPayload.totalsCents.totalDeductionsCents;
        totalAllowancesCents += recordPayload.totalsCents.totalAllowancesCents;

        const record = await tx.payrollRecord.create({
          data: {
            payrollCycleId: cycle.id,
            employeeId: employee.id,
            compensationId: recordPayload.compensationId,
            baseSalary: recordPayload.baseSalary,
            grossPay: recordPayload.grossPay,
            totalAllowances: recordPayload.totalAllowances,
            taxableIncome: recordPayload.taxableIncome,
            totalDeductions: recordPayload.totalDeductions,
            netPay: recordPayload.netPay,
            currency: recordPayload.currency,
            status: recordPayload.status,
            hasAnomaly: recordPayload.hasAnomaly,
            anomalyReason: recordPayload.anomalyReason
          }
        });

        if (recordPayload.lineItems.length) {
          await tx.payrollLineItem.createMany({
            data: recordPayload.lineItems.map((line) => ({
              payrollRecordId: record.id,
              type: line.type,
              sourceType: line.sourceType,
              name: line.name,
              amount: line.amount,
              calculationReference: line.calculationReference
            }))
          });
        }
      }

      await tx.payrollCycle.update({
        where: { id: cycle.id },
        data: { status: 'PENDING_APPROVAL' }
      });

      const after = await buildCycleSnapshot(tx, cycle.id);

      await createPayrollAuditLog(tx, {
        cycleId: cycle.id,
        action: auditAction,
        performedById: auth.userId,
        payloadBefore: before,
        payloadAfter: {
          ...after,
          totalsCents: {
            totalGross: centsToAmountString(totalGrossCents),
            totalNet: centsToAmountString(totalNetCents),
            totalDeductions: centsToAmountString(totalDeductionsCents),
            totalAllowances: centsToAmountString(totalAllowancesCents)
          },
          flaggedCount
        }
      });

      await auditService.log({
        actorId: auth.userId,
        action: auditAction === 'PAYROLL_RUN' ? AUDIT_ACTIONS.PAYROLL_RUN : AUDIT_ACTIONS.PAYROLL_RECALCULATED,
        entityType: 'PayrollCycle',
        entityId: cycle.id,
        oldValues: before,
        newValues: {
          ...after,
          totalsCents: {
            totalGross: centsToAmountString(totalGrossCents),
            totalNet: centsToAmountString(totalNetCents),
            totalDeductions: centsToAmountString(totalDeductionsCents),
            totalAllowances: centsToAmountString(totalAllowancesCents)
          },
          flaggedCount
        },
        req
      }, tx);

      return after;
    });
  },

  async listRecords(auth, query = {}) {
    const { page, limit, skip } = parsePagination(query);

    const where = { deletedAt: null };

    if (query.cycleId) where.payrollCycleId = query.cycleId;
    if (query.status) where.status = query.status;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.month || query.year) {
      where.cycle = {};
      if (query.month) where.cycle.periodMonth = Number(query.month);
      if (query.year) where.cycle.periodYear = Number(query.year);
    }

    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      where.employeeId = auth.userId;
    }

    if (query.search) {
      where.employee = {
        fullName: { contains: String(query.search), mode: 'insensitive' }
      };
    }

    const sortBy = String(query.sortBy || 'createdAt');
    const sortOrder = String(query.sortOrder || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    const orderByMap = {
      employee: { employee: { fullName: sortOrder } },
      grossPay: { grossPay: sortOrder },
      netPay: { netPay: sortOrder },
      totalDeductions: { totalDeductions: sortOrder },
      status: { status: sortOrder },
      createdAt: { createdAt: sortOrder }
    };

    const orderBy = orderByMap[sortBy] || orderByMap.createdAt;

    const [items, total] = await prisma.$transaction([
      prisma.payrollRecord.findMany({
        where,
        include: {
          employee: {
            select: {
              id: true,
              fullName: true,
              departmentId: true,
              department: { select: { id: true, name: true, slug: true } }
            }
          },
          cycle: {
            select: {
              id: true,
              periodMonth: true,
              periodYear: true,
              status: true,
              startDate: true,
              endDate: true
            }
          }
        },
        orderBy,
        skip,
        take: limit
      }),
      prisma.payrollRecord.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async getRecord(auth, recordId) {
    const record = await prisma.payrollRecord.findFirst({
      where: { id: recordId, deletedAt: null },
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
        cycle: true,
        compensation: true,
        lineItems: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] },
        audits: {
          include: { performedBy: { select: { id: true, fullName: true, email: true } } },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!record) throw new AppError('Payroll record not found', 404);
    domainGuardService.cannotViewUnauthorizedSalary(auth, record.employeeId);

    const previousRecord = await prisma.payrollRecord.findFirst({
      where: {
        employeeId: record.employeeId,
        deletedAt: null,
        cycle: {
          OR: [
            { periodYear: { lt: record.cycle.periodYear } },
            { periodYear: record.cycle.periodYear, periodMonth: { lt: record.cycle.periodMonth } }
          ]
        }
      },
      include: {
        cycle: { select: { id: true, periodMonth: true, periodYear: true, status: true } },
        lineItems: { orderBy: [{ type: 'asc' }, { createdAt: 'asc' }] }
      },
      orderBy: [{ cycle: { periodYear: 'desc' } }, { cycle: { periodMonth: 'desc' } }]
    });

    return {
      ...record,
      previousRecord: previousRecord || null
    };
  },

  async summary(auth, query = {}) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('You do not have access to payroll summary data', 403);
    }

    const where = { deletedAt: null };

    if (query.cycleId) where.id = query.cycleId;
    if (query.month) where.periodMonth = Number(query.month);
    if (query.year) where.periodYear = Number(query.year);

    const cycle = await prisma.payrollCycle.findFirst({
      where,
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }]
    });

    if (!cycle) {
      return {
        cycle: null,
        kpis: {
          totalPayrollCost: 0,
          totalNetPay: 0,
          totalDeductions: 0,
          employeeCount: 0,
          pendingApprovals: 0,
          flaggedRecords: 0
        }
      };
    }

    const [aggregate, pendingApprovals, flaggedRecords] = await prisma.$transaction([
      prisma.payrollRecord.aggregate({
        where: { payrollCycleId: cycle.id, deletedAt: null },
        _sum: {
          grossPay: true,
          netPay: true,
          totalDeductions: true
        },
        _count: true
      }),
      prisma.payrollRecord.count({
        where: {
          payrollCycleId: cycle.id,
          deletedAt: null,
          status: { in: ['CALCULATED', 'FLAGGED'] }
        }
      }),
      prisma.payrollRecord.count({
        where: {
          payrollCycleId: cycle.id,
          deletedAt: null,
          hasAnomaly: true
        }
      })
    ]);

    return {
      cycle,
      kpis: {
        totalPayrollCost: aggregate._sum.grossPay || 0,
        totalNetPay: aggregate._sum.netPay || 0,
        totalDeductions: aggregate._sum.totalDeductions || 0,
        employeeCount: aggregate._count || 0,
        pendingApprovals,
        flaggedRecords
      }
    };
  },

  async exportCycleSummary(auth, cycleId) {
    if (!accessControlService.isFinance(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('You do not have access to payroll exports', 403);
    }

    const cycle = await buildCycleSnapshot(prisma, cycleId);

    const records = await prisma.payrollRecord.findMany({
      where: { payrollCycleId: cycleId, deletedAt: null },
      include: {
        employee: {
          select: {
            fullName: true,
            department: { select: { name: true } }
          }
        }
      },
      orderBy: [{ employee: { fullName: 'asc' } }]
    });

    const rows = records.map((record) => ({
      employee: record.employee?.fullName || 'Unknown',
      department: record.employee?.department?.name || 'Unassigned',
      baseSalary: Number(record.baseSalary),
      allowances: Number(record.totalAllowances),
      deductions: Number(record.totalDeductions),
      grossPay: Number(record.grossPay),
      netPay: Number(record.netPay),
      status: record.status,
      flagged: record.hasAnomaly ? 'YES' : 'NO'
    }));

    const report = {
      reportType: 'payroll-summary',
      generatedAt: new Date().toISOString(),
      generatedBy: { fullName: 'Finance Payroll Engine' },
      filters: {
        periodMonth: cycle.periodMonth,
        periodYear: cycle.periodYear,
        cycleId: cycle.id,
        status: cycle.status
      },
      totals: cycle.totals,
      columns: ['employee', 'department', 'baseSalary', 'allowances', 'deductions', 'grossPay', 'netPay', 'status', 'flagged'],
      rows
    };

    const exported = exportService.buildExport(report, 'csv');
    return {
      ...exported,
      fileName: `payroll-summary-${cycle.periodYear}-${String(cycle.periodMonth).padStart(2, '0')}.csv`
    };
  },

  async exportPayslipPdf(auth, recordId) {
    const record = await this.getRecord(auth, recordId);

    const lines = [];
    lines.push('AptusOS - Payroll Payslip');
    lines.push(`Period: ${record.cycle.periodMonth}/${record.cycle.periodYear}`);
    lines.push(`Employee: ${record.employee?.fullName || 'Unknown'}`);
    lines.push(`Department: ${record.employee?.department?.name || 'Unassigned'}`);
    lines.push(`Currency: ${record.currency}`);
    lines.push(`Status: ${record.status}`);
    lines.push('');
    lines.push(`Base Salary: ${record.baseSalary}`);
    lines.push(`Total Allowances: ${record.totalAllowances}`);
    lines.push(`Gross Pay: ${record.grossPay}`);
    lines.push(`Taxable Income: ${record.taxableIncome}`);
    lines.push(`Total Deductions: ${record.totalDeductions}`);
    lines.push(`Net Pay: ${record.netPay}`);
    lines.push('');
    lines.push('Line Items:');

    record.lineItems.forEach((lineItem) => {
      lines.push(`- ${lineItem.type} | ${lineItem.name} | ${lineItem.amount}`);
    });

    if (record.previousRecord) {
      lines.push('');
      lines.push(`Previous Period: ${record.previousRecord.cycle.periodMonth}/${record.previousRecord.cycle.periodYear}`);
      lines.push(`Previous Net Pay: ${record.previousRecord.netPay}`);
    }

    const content = createBasicPdf(lines);
    return {
      mimeType: 'application/pdf',
      extension: 'pdf',
      fileName: `payslip-${record.employee?.fullName?.replace(/\s+/g, '-').toLowerCase() || record.employeeId}-${record.cycle.periodYear}-${String(record.cycle.periodMonth).padStart(2, '0')}.pdf`,
      content
    };
  },

  // Legacy compatibility wrappers
  async listPayslips(auth, query = {}) {
    const records = await this.listRecords(auth, {
      cycleId: query.cycleId,
      status: query.approvalStatus,
      employeeId: query.employeeId,
      month: query.month,
      year: query.year,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      search: query.search
    });

    return {
      ...records,
      items: records.items.map((item) => ({
        id: item.id,
        employeeId: item.employeeId,
        employee: item.employee,
        month: item.cycle?.periodMonth,
        year: item.cycle?.periodYear,
        grossPay: item.grossPay,
        totalDeductions: item.totalDeductions,
        netPay: item.netPay,
        generatedById: item.cycle?.createdById,
        approvalStatus: item.status,
        lockedAt: item.cycle?.lockedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
    };
  },

  async getPayslip(auth, id) {
    const record = await this.getRecord(auth, id);
    return {
      id: record.id,
      employeeId: record.employeeId,
      employee: record.employee,
      month: record.cycle?.periodMonth,
      year: record.cycle?.periodYear,
      grossPay: record.grossPay,
      totalDeductions: record.totalDeductions,
      netPay: record.netPay,
      approvalStatus: record.status,
      lockedAt: record.cycle?.lockedAt,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lineItems: record.lineItems,
      audits: record.audits,
      previousRecord: record.previousRecord
    };
  }
};

module.exports = payrollService;
