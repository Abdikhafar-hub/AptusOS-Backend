const bcrypt = require('bcrypt');
const slugify = require('slugify');
const env = require('../src/config/env');
const { PERMISSIONS } = require('../src/constants/permissions');
const { ROLES } = require('../src/constants/roles');
const { ALL_ROLES, SETTING_SCOPE_TYPES, SETTINGS_SECTION_DEFINITIONS } = require('../src/config/settingsCatalog');
const prisma = require('../src/prisma/client');

const roles = [
  ['GENERAL_MANAGER', 'General Manager', 'Highest authority with full visibility and final approvals.'],
  ['DEPARTMENT_HEAD', 'Department Head', 'Manages department staff, work, documents, announcements, and approvals.'],
  ['HR_MANAGER', 'HR Manager', 'Handles staff lifecycle, leave, attendance, HR actions, trainings, performance, and separations.'],
  ['FINANCE_ACCOUNTS_MANAGER', 'Finance & Accounts Manager', 'Handles finance requests, budgets, petty cash, reimbursements, payroll review/approval, payment proof uploads, invoice/payment archives, tax/KRA documents, financial reports, and accounting records.'],
  ['SALES_COMPLIANCE_OFFICER', 'Sales & Compliance Officer', 'Handles compliance onboarding, regulatory docs, sales reports, risks, incidents, and escalations.'],
  ['OPERATIONS_PROCUREMENT_OFFICER', 'Operations / Procurement Officer', 'Handles requisitions, vendor documents, logistics tasks, and operational coordination.'],
  ['EMPLOYEE', 'Employee', 'Normal staff self-service access.']
];

const rolePermissions = {
  GENERAL_MANAGER: PERMISSIONS,
  DEPARTMENT_HEAD: ['departments:read', 'documents:create', 'documents:read', 'approvals:read', 'approvals:act', 'tasks:create', 'tasks:update', 'tasks:read', 'communication:use', 'announcements:publish', 'reports:read'],
  HR_MANAGER: ['users:create', 'users:read', 'users:update', 'documents:create', 'documents:read', 'approvals:create', 'approvals:read', 'approvals:act', 'tasks:read', 'communication:use', 'announcements:publish', 'hr:manage', 'hr:read', 'trainings:manage', 'performance:manage', 'reports:read'],
  FINANCE_ACCOUNTS_MANAGER: ['documents:create', 'documents:read', 'approvals:create', 'approvals:read', 'approvals:act', 'tasks:read', 'communication:use', 'payroll:manage', 'payroll:read', 'finance:manage', 'finance:read', 'accounts:manage', 'reports:read'],
  SALES_COMPLIANCE_OFFICER: ['documents:create', 'documents:read', 'approvals:create', 'approvals:read', 'approvals:act', 'tasks:create', 'tasks:update', 'tasks:read', 'communication:use', 'customers:manage', 'sales_compliance:manage', 'compliance:manage', 'reports:read'],
  OPERATIONS_PROCUREMENT_OFFICER: ['documents:create', 'documents:read', 'approvals:create', 'approvals:read', 'approvals:act', 'tasks:create', 'tasks:update', 'tasks:read', 'communication:use', 'operations:manage', 'reports:read'],
  EMPLOYEE: ['documents:create', 'documents:read', 'approvals:create', 'tasks:read', 'communication:use', 'finance:read', 'payroll:read', 'hr:read']
};

const departments = ['HR', 'Finance', 'Accounts', 'Sales & Compliance', 'Operations / Procurement', 'Management'];

const leavePolicies = [
  ['Annual Leave', 'ANNUAL', 21],
  ['Sick Leave', 'SICK', 14],
  ['Maternity Leave', 'MATERNITY', 90],
  ['Paternity Leave', 'PATERNITY', 14],
  ['Compassionate Leave', 'COMPASSIONATE', 5],
  ['Study Leave', 'STUDY', 10],
  ['Unpaid Leave', 'UNPAID', 0]
];

async function seedSettingValues({ organizationId, section, scopeType, scopeKey, values }) {
  for (const [key, value] of Object.entries(values)) {
    await prisma.setting.upsert({
      where: {
        organizationId_section_key_scopeType_scopeKey: {
          organizationId,
          section,
          key,
          scopeType,
          scopeKey
        }
      },
      update: { value },
      create: {
        organizationId,
        section,
        key,
        scopeType,
        scopeKey,
        value
      }
    });
  }
}

async function main() {
  const organizationId = env.defaultOrganizationId || 'aptus-default-org';
  const permissions = {};
  for (const key of PERMISSIONS) {
    permissions[key] = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: { key, description: key.replace(':', ' ') }
    });
  }

  const roleRows = {};
  for (const [name, displayName, description] of roles) {
    const existingRole = await prisma.role.findFirst({
      where: { name, deletedAt: null }
    });

    roleRows[name] = existingRole
      ? await prisma.role.update({
          where: { id: existingRole.id },
          data: { displayName, description, isSystem: true }
        })
      : await prisma.role.create({
          data: { name, displayName, description, isSystem: true }
        });

    for (const key of rolePermissions[name]) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roleRows[name].id, permissionId: permissions[key].id } },
        update: {},
        create: { roleId: roleRows[name].id, permissionId: permissions[key].id }
      });
    }
  }

  const combinedFinanceRole = roleRows[ROLES.FINANCE_ACCOUNTS_MANAGER];
  const legacyFinanceRoles = await prisma.role.findMany({
    where: {
      deletedAt: null,
      name: { in: ['FINANCE_MANAGER', 'ACCOUNTS_OFFICER'] }
    }
  });

  for (const legacyRole of legacyFinanceRoles) {
    await prisma.user.updateMany({ where: { roleId: legacyRole.id }, data: { roleId: combinedFinanceRole.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: legacyRole.id } });
    await prisma.role.update({
      where: { id: legacyRole.id },
      data: { deletedAt: new Date(), description: 'Legacy finance/accounts role replaced by FINANCE_ACCOUNTS_MANAGER.' }
    });
  }

  const departmentRows = {};
  for (const name of departments) {
    const slug = slugify(name, { lower: true, strict: true });
    departmentRows[name] = await prisma.department.upsert({
      where: { slug },
      update: {},
      create: { name, slug, description: `${name} department`, status: 'ACTIVE' }
    });
    await prisma.channel.upsert({
      where: { slug: `${slug}-channel` },
      update: {},
      create: { name: `${name} Channel`, slug: `${slug}-channel`, departmentId: departmentRows[name].id }
    });
  }

  for (const [name, leaveType, annualDays] of leavePolicies) {
    const existing = await prisma.leavePolicy.findFirst({ where: { name, leaveType, departmentId: null } });
    if (!existing) await prisma.leavePolicy.create({ data: { name, leaveType, annualDays } });
  }

  if (env.defaultGm.email && env.defaultGm.password) {
    const passwordHash = await bcrypt.hash(env.defaultGm.password, env.bcryptSaltRounds);
    const gm = await prisma.user.upsert({
      where: { email: env.defaultGm.email },
      update: { roleId: roleRows.GENERAL_MANAGER.id, isActive: true },
      create: {
        firstName: env.defaultGm.firstName,
        lastName: env.defaultGm.lastName,
        fullName: `${env.defaultGm.firstName} ${env.defaultGm.lastName}`,
        email: env.defaultGm.email,
        roleId: roleRows.GENERAL_MANAGER.id,
        departmentId: departmentRows.Management.id,
        jobTitle: 'General Manager',
        employmentType: 'FULL_TIME',
        employmentStatus: 'ACTIVE',
        passwordHash,
        mustChangePassword: true
      }
    });
    await prisma.department.update({ where: { id: departmentRows.Management.id }, data: { headId: gm.id } });
    await prisma.departmentMember.upsert({
      where: { departmentId_userId: { departmentId: departmentRows.Management.id, userId: gm.id } },
      update: {},
      create: { departmentId: departmentRows.Management.id, userId: gm.id }
    });

    await Promise.all(Object.values(SETTINGS_SECTION_DEFINITIONS).map(async (sectionDefinition) => {
      if (sectionDefinition.scopeType === SETTING_SCOPE_TYPES.USER) {
        await seedSettingValues({
          organizationId,
          section: sectionDefinition.key,
          scopeType: SETTING_SCOPE_TYPES.USER,
          scopeKey: gm.id,
          values: sectionDefinition.defaults
        });
      }
    }));
  }

  for (const sectionDefinition of Object.values(SETTINGS_SECTION_DEFINITIONS)) {
    if (sectionDefinition.scopeType === SETTING_SCOPE_TYPES.ORGANIZATION) {
      await seedSettingValues({
        organizationId,
        section: sectionDefinition.key,
        scopeType: SETTING_SCOPE_TYPES.ORGANIZATION,
        scopeKey: 'GLOBAL',
        values: sectionDefinition.defaults
      });
      continue;
    }

    if (sectionDefinition.scopeType === SETTING_SCOPE_TYPES.ROLE) {
      for (const roleName of ALL_ROLES) {
        if (!sectionDefinition.visibleTo.includes(roleName)) continue;
        await seedSettingValues({
          organizationId,
          section: sectionDefinition.key,
          scopeType: SETTING_SCOPE_TYPES.ROLE,
          scopeKey: roleName,
          values: sectionDefinition.defaults
        });
      }
      continue;
    }

    if (sectionDefinition.scopeType === SETTING_SCOPE_TYPES.DEPARTMENT) {
      for (const department of Object.values(departmentRows)) {
        await seedSettingValues({
          organizationId,
          section: sectionDefinition.key,
          scopeType: SETTING_SCOPE_TYPES.DEPARTMENT,
          scopeKey: department.id,
          values: sectionDefinition.defaults
        });
      }
    }
  }
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
