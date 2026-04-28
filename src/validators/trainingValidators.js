const { z } = require('zod');

const toStringArray = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
      } catch (_) {
        // fall through to comma split
      }
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
}, z.array(z.string()));

const coerceBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  return value;
}, z.boolean());

module.exports = {
  create: z.object({
    body: z.object({
      title: z.string().min(3),
      description: z.string().min(3),
      trainingDate: z.coerce.date().optional(),
      startDateTime: z.coerce.date().optional(),
      endDateTime: z.coerce.date().optional(),
      trainerName: z.string().optional(),
      trainerType: z.enum(['INTERNAL', 'EXTERNAL']).optional(),
      trainerContact: z.string().optional(),
      trainerOrganization: z.string().optional(),
      trainingType: z.enum(['COMPLIANCE', 'SOP', 'SAFETY', 'SALES', 'HR', 'TECHNICAL', 'ONBOARDING', 'OTHER']).optional(),
      trainingTypeLabel: z.enum(['HR', 'TECHNICAL', 'COMPLIANCE', 'SAFETY', 'SOFT_SKILLS', 'OTHER']).optional(),
      trainingMode: z.enum(['IN_PERSON', 'VIRTUAL', 'HYBRID']).optional(),
      location: z.string().optional(),
      meetingLink: z.string().optional(),
      durationHours: z.coerce.number().positive().optional(),
      capacity: z.coerce.number().int().positive().optional(),
      status: z.enum(['DRAFT', 'SCHEDULED', 'COMPLETED', 'CANCELLED']).optional(),
      attendanceRequired: coerceBoolean.optional(),
      certificationProvided: coerceBoolean.optional(),
      assessmentRequired: coerceBoolean.optional(),
      sendReminder: coerceBoolean.optional(),
      notesInstructions: z.string().optional(),
      departmentId: z.string().optional(),
      participantIds: toStringArray.optional(),
      participantDepartmentIds: toStringArray.optional(),
      participantRoleIds: toStringArray.optional()
    }).passthrough()
  }),
  attendance: z.object({
    body: z.object({
      status: z.enum(['ASSIGNED', 'ATTENDED', 'COMPLETED', 'MISSED', 'CANCELLED']),
      certificateDocumentId: z.string().optional()
    })
  }),
  certificateUpload: z.object({
    body: z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      visibility: z.enum(['COMPANY_INTERNAL', 'DEPARTMENT_ONLY', 'PRIVATE', 'RESTRICTED']).optional()
    }).passthrough()
  }),
  notifyParticipants: z.object({
    body: z.object({
      participantIds: z.array(z.string()).optional(),
      message: z.string().optional()
    })
  })
};
