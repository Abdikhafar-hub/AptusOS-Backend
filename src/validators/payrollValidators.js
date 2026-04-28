const { z } = require('zod');

module.exports = {
  remunerationCreate: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      baseSalary: z.coerce.number().positive(),
      allowances: z.any().optional(),
      deductions: z.any().optional(),
      currency: z.string().min(3).default('KES'),
      effectiveFrom: z.coerce.date(),
      effectiveTo: z.coerce.date().optional()
    })
  }),
  payslipGenerate: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      month: z.number().int().min(1).max(12),
      year: z.number().int().min(2000).max(3000)
    })
  }),
  payslipDecision: z.object({
    body: z.object({
      decision: z.enum(['APPROVED', 'REJECTED']),
      comment: z.string().optional()
    })
  })
};
