const prisma = require('../prisma/client');
const { ROLES, normalizeRoleName } = require('../constants/roles');

const highPriorityLevels = new Set(['HIGH', 'URGENT', 'CRITICAL']);
const unique = (values) => [...new Set((values || []).filter(Boolean))];

async function getRoleMap(roleNames = []) {
  const roles = await prisma.role.findMany({
    where: {
      name: { in: unique(roleNames) },
      deletedAt: null
    },
    select: { id: true, name: true, displayName: true }
  });

  return new Map(roles.map((role) => [role.name, role]));
}

function appendRoleStep(steps, roleMap, roleName) {
  const role = roleMap.get(roleName);
  if (!role || steps.some((step) => step.approverRoleId === role.id)) return;
  steps.push({ approverRoleId: role.id, stepOrder: steps.length + 1 });
}

function appendUserStep(steps, userId) {
  if (!userId || steps.some((step) => step.approverUserId === userId)) return;
  steps.push({ approverUserId: userId, stepOrder: steps.length + 1 });
}

const approvalPolicyService = {
  async buildFinanceRequestSteps({ requesterRoleName, amount }) {
    const requesterRole = normalizeRoleName(requesterRoleName);
    const roleMap = await getRoleMap([ROLES.FINANCE_ACCOUNTS_MANAGER, ROLES.GENERAL_MANAGER]);
    const steps = [];

    if (requesterRole === ROLES.FINANCE_ACCOUNTS_MANAGER) appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    else appendRoleStep(steps, roleMap, ROLES.FINANCE_ACCOUNTS_MANAGER);

    if (Number(amount || 0) >= 100000) appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);

    return steps;
  },

  async buildRequisitionSteps({ requesterRoleName, estimatedAmount }) {
    const requesterRole = normalizeRoleName(requesterRoleName);
    const amount = Number(estimatedAmount || 0);
    const roleMap = await getRoleMap([
      ROLES.OPERATIONS_PROCUREMENT_OFFICER,
      ROLES.FINANCE_ACCOUNTS_MANAGER,
      ROLES.GENERAL_MANAGER
    ]);
    const steps = [];

    if (requesterRole !== ROLES.OPERATIONS_PROCUREMENT_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.OPERATIONS_PROCUREMENT_OFFICER);
    }
    if (amount >= 50000) {
      appendRoleStep(steps, roleMap, ROLES.FINANCE_ACCOUNTS_MANAGER);
    }
    if (amount >= 150000 || !steps.length) {
      appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    }

    return steps;
  },

  async buildCustomerOnboardingSteps({ requesterRoleName, escalateToGeneralManager = true }) {
    const requesterRole = normalizeRoleName(requesterRoleName);
    const roleMap = await getRoleMap([ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER]);
    const steps = [];

    if (requesterRole !== ROLES.SALES_COMPLIANCE_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.SALES_COMPLIANCE_OFFICER);
    }
    if (escalateToGeneralManager || !steps.length) {
      appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    }

    return steps;
  },

  async buildPayrollSteps({ requesterRoleName }) {
    const requesterRole = normalizeRoleName(requesterRoleName);
    const roleMap = await getRoleMap([ROLES.FINANCE_ACCOUNTS_MANAGER, ROLES.GENERAL_MANAGER]);
    const steps = [];

    if (requesterRole === ROLES.FINANCE_ACCOUNTS_MANAGER) appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    else appendRoleStep(steps, roleMap, ROLES.FINANCE_ACCOUNTS_MANAGER);

    if (!steps.length) appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);

    return steps;
  },

  async buildDocumentSteps({ ownerType, requesterRoleName, departmentHeadId, actorId }) {
    const requesterRole = normalizeRoleName(requesterRoleName);
    const roleMap = await getRoleMap([
      ROLES.HR_MANAGER,
      ROLES.FINANCE_ACCOUNTS_MANAGER,
      ROLES.SALES_COMPLIANCE_OFFICER,
      ROLES.OPERATIONS_PROCUREMENT_OFFICER,
      ROLES.GENERAL_MANAGER
    ]);
    const steps = [];

    const primaryRole = ownerType === 'HR'
      ? ROLES.HR_MANAGER
      : ownerType === 'FINANCE'
        ? ROLES.FINANCE_ACCOUNTS_MANAGER
        : ownerType === 'COMPLIANCE' || ownerType === 'CUSTOMER'
          ? ROLES.SALES_COMPLIANCE_OFFICER
          : ownerType === 'OPERATIONS'
            ? ROLES.OPERATIONS_PROCUREMENT_OFFICER
            : null;

    if (primaryRole && requesterRole !== primaryRole) {
      appendRoleStep(steps, roleMap, primaryRole);
    } else if (primaryRole) {
      appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    } else if (departmentHeadId && departmentHeadId !== actorId) {
      appendUserStep(steps, departmentHeadId);
    }

    if (!steps.length) appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);

    return steps;
  },

  async buildComplianceItemApprovalSteps({ requesterRoleName, type, priority }) {
    const roleMap = await getRoleMap([ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER]);
    const steps = [];
    const requesterRole = normalizeRoleName(requesterRoleName);
    const escalateToGeneralManager = ['POLICY', 'SOP'].includes(String(type || '').toUpperCase())
      || highPriorityLevels.has(String(priority || '').toUpperCase());

    if (requesterRole !== ROLES.SALES_COMPLIANCE_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.SALES_COMPLIANCE_OFFICER);
    }
    if (escalateToGeneralManager || !steps.length) {
      appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    }

    return steps;
  },

  async buildIncidentClosureSteps({ requesterRoleName, severity }) {
    const roleMap = await getRoleMap([ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER]);
    const steps = [];
    const requesterRole = normalizeRoleName(requesterRoleName);
    const escalateToGeneralManager = highPriorityLevels.has(String(severity || '').toUpperCase());

    if (requesterRole !== ROLES.SALES_COMPLIANCE_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.SALES_COMPLIANCE_OFFICER);
    }
    if (escalateToGeneralManager || !steps.length) {
      appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    }

    return steps;
  },

  async buildRiskMitigationSteps({ requesterRoleName }) {
    const roleMap = await getRoleMap([ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER]);
    const steps = [];
    const requesterRole = normalizeRoleName(requesterRoleName);

    if (requesterRole !== ROLES.SALES_COMPLIANCE_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.SALES_COMPLIANCE_OFFICER);
    }
    appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);

    return steps;
  },

  async buildDiscountRequestSteps({ requesterRoleName }) {
    const roleMap = await getRoleMap([ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER]);
    const steps = [];
    const requesterRole = normalizeRoleName(requesterRoleName);

    if (requesterRole !== ROLES.SALES_COMPLIANCE_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.SALES_COMPLIANCE_OFFICER);
    }
    appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    return steps;
  },

  async buildCriticalIssueClosureSteps({ requesterRoleName }) {
    const roleMap = await getRoleMap([ROLES.SALES_COMPLIANCE_OFFICER, ROLES.GENERAL_MANAGER]);
    const steps = [];
    const requesterRole = normalizeRoleName(requesterRoleName);

    if (requesterRole !== ROLES.SALES_COMPLIANCE_OFFICER) {
      appendRoleStep(steps, roleMap, ROLES.SALES_COMPLIANCE_OFFICER);
    }
    appendRoleStep(steps, roleMap, ROLES.GENERAL_MANAGER);
    return steps;
  }
};

module.exports = approvalPolicyService;
