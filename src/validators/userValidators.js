const { z } = require('zod');

const base = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  roleId: z.string().min(1),
  phone: z.string().optional(),
  alternatePhone: z.string().optional(),
  departmentId: z.string().optional(),
  managerId: z.string().optional(),
  jobTitle: z.string().optional(),
  employmentType: z.string().optional(),
  employmentStatus: z.string().optional(),
  joinDate: z.preprocess((value) => (value === '' ? undefined : value), z.coerce.date().optional()),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  address: z.string().optional(),
  notes: z.string().optional()
}).strict();

module.exports = {
  create: z.object({ body: base }),
  update: z.object({ body: base.partial().refine((value) => value.employmentStatus !== 'TERMINATED', 'Termination must go through HR action workflow') }),
  status: z.object({ body: z.object({ reason: z.string().min(3).optional() }) }),
  document: z.object({
    body: z.object({
      title: z.string().min(1),
      description: z.string().optional(),
      category: z.string().min(1),
      visibility: z.enum(['COMPANY_INTERNAL', 'DEPARTMENT_ONLY', 'PRIVATE', 'RESTRICTED']).optional(),
      expiryDate: z.coerce.date().optional(),
      reminderDate: z.coerce.date().optional()
    })
  })
};
