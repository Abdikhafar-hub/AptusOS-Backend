const { z } = require('zod');

const reportTypes = [
  'finance-requests',
  'expenses',
  'payments',
  'budgets',
  'budget-variance',
  'payroll',
  'petty-cash',
  'tax-kra',
  'payment-proofs',
  'accounts-archive',
  'audit-trail'
];

const reportQuery = z.object({
  query: z.object({
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    quickRange: z.string().optional(),
    departmentId: z.string().optional(),
    status: z.string().optional(),
    requesterId: z.string().optional(),
    approverId: z.string().optional(),
    paymentMethod: z.string().optional(),
    amountMin: z.union([z.string(), z.number()]).optional(),
    amountMax: z.union([z.string(), z.number()]).optional(),
    referenceNumber: z.string().optional(),
    vendorPayee: z.string().optional(),
    employeeId: z.string().optional(),
    costCenter: z.string().optional(),
    approvalState: z.string().optional(),
    type: z.string().optional(),
    month: z.union([z.string(), z.number()]).optional(),
    year: z.union([z.string(), z.number()]).optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    page: z.union([z.string(), z.number()]).optional(),
    limit: z.union([z.string(), z.number()]).optional(),
    format: z.string().optional()
  }).passthrough()
});

const reportTypeParam = z.object({
  params: z.object({
    reportType: z.enum(reportTypes)
  })
});

const savedViewCreate = z.object({
  body: z.object({
    id: z.string().optional(),
    name: z.string().min(2),
    reportType: z.enum(reportTypes),
    filters: z.record(z.any()).optional(),
    visibleColumns: z.array(z.string()).optional(),
    createdAt: z.string().optional()
  }).passthrough()
});

const savedViewIdParam = z.object({
  params: z.object({
    id: z.string().min(1)
  })
});

module.exports = {
  reportTypes,
  reportQuery,
  reportTypeParam,
  savedViewCreate,
  savedViewIdParam
};
