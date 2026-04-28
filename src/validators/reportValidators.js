const { z } = require('zod');

const reportTypes = [
  'leave',
  'attendance',
  'training',
  'performance',
  'hr-actions',
  'separations',
  'approvals',
  'customer-onboarding',
  'sales'
];

const reportQuery = z.object({
  query: z.object({
    type: z.enum(reportTypes),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    departmentId: z.string().optional(),
    employeeId: z.string().optional(),
    userId: z.string().optional(),
    status: z.string().optional(),
    filterType: z.string().optional(),
    typeValue: z.string().optional(),
    typeFilter: z.string().optional(),
    activityType: z.string().optional()
  }).passthrough()
});

module.exports = {
  reportQuery,
  reportTypes
};
