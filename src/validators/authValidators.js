const { z } = require('zod');

const strongPassword = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
  .regex(/[a-z]/, 'Password must include at least one lowercase letter')
  .regex(/[0-9]/, 'Password must include at least one number')
  .regex(/[^A-Za-z0-9]/, 'Password must include at least one symbol');
const optionalTrimmedString = z.string().trim().min(1).optional();

module.exports = {
  login: z.object({ body: z.object({ email: z.string().trim().email(), password: strongPassword }) }),
  refresh: z.object({ body: z.object({ refreshToken: z.string().min(10) }) }),
  logout: z.object({ body: z.object({ refreshToken: z.string().min(10).optional() }) }),
  requestReset: z.object({ body: z.object({ email: z.string().email() }) }),
  reset: z.object({ body: z.object({ token: z.string().min(10), password: strongPassword }) }),
  setup: z.object({ body: z.object({ token: z.string().min(10), password: strongPassword }) }),
  changePassword: z.object({
    body: z.object({
      currentPassword: z.string().min(1),
      newPassword: strongPassword
    }).refine((value) => value.currentPassword !== value.newPassword, {
      message: 'New password must be different from current password',
      path: ['newPassword']
    })
  }),
  updateMe: z.object({
    body: z.object({
      firstName: optionalTrimmedString,
      lastName: optionalTrimmedString,
      email: z.string().trim().email().optional(),
      phone: optionalTrimmedString,
      alternatePhone: optionalTrimmedString,
      address: optionalTrimmedString,
      emergencyContactName: optionalTrimmedString,
      emergencyContactPhone: optionalTrimmedString
    }).strict()
  })
};
