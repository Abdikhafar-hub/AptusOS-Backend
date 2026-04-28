const { z } = require('zod');
const { ROLES } = require('../constants/roles');

const roleEnum = z.enum([
  ROLES.GENERAL_MANAGER,
  ROLES.DEPARTMENT_HEAD,
  ROLES.HR_MANAGER,
  ROLES.FINANCE_ACCOUNTS_MANAGER,
  ROLES.SALES_COMPLIANCE_OFFICER,
  ROLES.OPERATIONS_PROCUREMENT_OFFICER,
  ROLES.EMPLOYEE
]);

const sectionParam = z.object({
  params: z.object({
    section: z.string().min(1).regex(/^[a-z0-9_]+$/)
  })
});

const roleParam = z.object({
  params: z.object({
    role: roleEnum
  })
});

const updateSectionBody = z.object({
  body: z.object({
    values: z.record(z.any()).optional()
  }).passthrough()
});

const updateRoleSettingsBody = z.object({
  body: z.object({
    sections: z.record(z.record(z.any()))
  })
});

module.exports = {
  sectionParam,
  roleParam,
  updateSectionBody,
  updateRoleSettingsBody
};
