const { z } = require('zod');

const leaveTypes = ['ANNUAL', 'SICK', 'MATERNITY', 'PATERNITY', 'COMPASSIONATE', 'UNPAID', 'STUDY', 'OTHER'];
const leaveHalfDayOptions = ['NONE', 'FIRST_DAY', 'LAST_DAY', 'FULL_HALF_DAY'];
const leaveCreateStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'];
const coerceBoolean = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return value;
}, z.boolean());

module.exports = {
  onboardingCreate: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      title: z.string().min(3).optional(),
      requiredItems: z.array(z.string().min(1)).optional(),
      checklistItems: z.array(
        z.object({
          title: z.string().min(1),
          description: z.string().optional(),
          isRequired: z.boolean().optional()
        })
      ).optional()
    })
  }),
  onboardingComplete: z.object({
    body: z.object({
      documentId: z.string().optional()
    })
  }),
  onboardingItemComment: z.object({
    body: z.object({
      body: z.string().min(1),
      mentions: z.array(z.string()).optional(),
      attachments: z.any().optional()
    })
  }),
  onboardingItemDocumentUpload: z.object({
    body: z.object({
      title: z.string().min(1).optional(),
      description: z.string().optional(),
      visibility: z.enum(['COMPANY_INTERNAL', 'DEPARTMENT_ONLY', 'PRIVATE', 'RESTRICTED']).optional()
    }).passthrough()
  }),
  leaveCreate: z.object({
    body: z.object({
      leaveType: z.enum(leaveTypes),
      startDate: z.coerce.date(),
      endDate: z.coerce.date(),
      reason: z.string().min(3)
    })
  }),
  leaveStaffCreate: z.object({
    body: z.object({
      employeeId: z.string().optional(),
      employee_id: z.string().optional(),
      leaveType: z.enum(leaveTypes).optional(),
      leave_type: z.enum(leaveTypes).optional(),
      startDate: z.coerce.date().optional(),
      start_date: z.coerce.date().optional(),
      endDate: z.coerce.date().optional(),
      end_date: z.coerce.date().optional(),
      halfDay: z.enum(leaveHalfDayOptions).optional(),
      half_day: z.enum(leaveHalfDayOptions).optional(),
      reason: z.string().optional(),
      notes: z.string().optional(),
      status: z.enum(leaveCreateStatuses).optional(),
      approvalStatus: z.enum(leaveCreateStatuses).optional(),
      notifyEmployee: coerceBoolean.optional(),
      notify_employee: coerceBoolean.optional(),
      notifyManager: coerceBoolean.optional(),
      notify_manager: coerceBoolean.optional()
    }).passthrough().superRefine((body, ctx) => {
      if (!(body.employeeId || body.employee_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['employeeId'],
          message: 'Employee is required'
        });
      }
      if (!(body.leaveType || body.leave_type)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['leaveType'],
          message: 'Leave type is required'
        });
      }
      if (!(body.startDate || body.start_date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['startDate'],
          message: 'Start date is required'
        });
      }
      if (!(body.endDate || body.end_date)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endDate'],
          message: 'End date is required'
        });
      }
    })
  }),
  leaveRouting: z.object({
    body: z.object({
      approverUserId: z.string().min(1),
      comment: z.string().min(1)
    })
  }),
  reviewDecision: z.object({
    body: z.object({
      decision: z.enum(['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO']),
      comment: z.string().min(1)
    })
  }),
  attendanceManual: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      date: z.coerce.date(),
      checkInAt: z.coerce.date().optional(),
      checkOutAt: z.coerce.date().optional(),
      status: z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'REMOTE', 'ON_LEAVE']).optional(),
      notes: z.string().optional()
    })
  }),
  hrWorkflowComment: z.object({
    body: z.object({
      body: z.string().min(1),
      mentions: z.array(z.string()).optional(),
      attachments: z.any().optional()
    })
  }),
  hrActionCreate: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      actionType: z.enum(['PROMOTION', 'DEMOTION', 'TRANSFER', 'WARNING', 'SUSPENSION', 'TERMINATION', 'SALARY_ADJUSTMENT', 'ROLE_CHANGE', 'DEPARTMENT_CHANGE', 'CONTRACT_UPDATE']),
      reason: z.string().min(3),
      effectiveDate: z.coerce.date(),
      approvalStatus: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED']).optional(),
      supportingDocumentId: z.string().optional(),
      changes: z.union([z.record(z.any()), z.string()]).optional()
    })
  }),
  hrActionCancel: z.object({
    body: z.object({
      comment: z.string().optional()
    })
  }),
  separationCreate: z.object({
    body: z.object({
      employeeId: z.string().min(1),
      type: z.enum(['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'CONTRACT_END']),
      reason: z.string().optional(),
      exitDate: z.coerce.date(),
      separationStatus: z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'COMPLETED', 'CANCELLED']).optional(),
      approvalNotes: z.string().optional(),
      uiSeparationType: z.string().optional(),
      separationCategory: z.enum(['VOLUNTARY', 'INVOLUNTARY']).optional(),
      eligibleForRehire: coerceBoolean.optional(),
      rehireRestrictionReason: z.string().optional(),
      noticeDetails: z.union([z.record(z.any()), z.string()]).optional(),
      handoverDetails: z.union([z.record(z.any()), z.string()]).optional(),
      clearanceChecklist: z.any().optional(),
      assetReturn: z.any().optional(),
      accessRevocation: z.union([z.record(z.any()), z.string()]).optional(),
      finalSettlement: z.union([z.record(z.any()), z.string()]).optional(),
      finalPaymentStatus: z.string().optional(),
      exitInterviewNotes: z.string().optional(),
      finalDocuments: z.any().optional(),
      documentLabels: z.array(z.string()).optional()
    }).passthrough()
  }),
  separationClearanceUpdate: z.object({
    body: z.object({
      clearanceChecklist: z.any()
    })
  }),
  separationAssetReturnUpdate: z.object({
    body: z.object({
      assetReturn: z.any()
    })
  }),
  separationExitInterviewUpdate: z.object({
    body: z.object({
      exitInterviewNotes: z.string().min(1)
    })
  })
};
