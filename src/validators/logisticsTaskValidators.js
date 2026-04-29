const { z } = require('zod');

const logisticsTaskTypes = [
  'SHIPMENT_HANDLING',
  'CUSTOMS_CLEARANCE',
  'WAREHOUSE_OPERATION',
  'TRANSPORT_DELIVERY',
  'COLD_CHAIN_MONITORING',
  'INVENTORY_MOVEMENT',
  'VENDOR_COORDINATION',
  'COMPLIANCE_INSPECTION',
  'EMERGENCY_RESPONSE'
];

const logisticsTaskStatuses = ['PENDING', 'IN_PROGRESS', 'AWAITING_CLEARANCE', 'IN_TRANSIT', 'DELAYED', 'COMPLETED', 'FAILED'];

const taskTypeEnum = z.enum(logisticsTaskTypes);
const taskStatusEnum = z.enum(logisticsTaskStatuses);

const itemSchema = z.object({
  itemName: z.string().min(1),
  quantity: z.coerce.number().positive(),
  unit: z.string().min(1),
  weight: z.coerce.number().positive().optional(),
  volume: z.coerce.number().positive().optional(),
  temperatureRequirement: z.string().optional(),
  specialHandlingNotes: z.string().optional()
});

const milestoneSchema = z.object({
  name: z.string().min(1),
  expectedDate: z.coerce.date(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'DELAYED', 'MISSED']),
  actualDate: z.coerce.date().optional()
});

const documentSchema = z.object({
  documentType: z.enum(['CUSTOMS_DOCUMENT', 'INVOICE', 'PACKING_LIST', 'BILL_OF_LADING_AIRWAY_BILL', 'CLEARANCE_CERTIFICATE', 'INSPECTION_REPORT', 'OTHER']),
  documentId: z.string().min(1)
});

const dependencySchema = z.object({
  dependsOnTaskId: z.string().optional(),
  blockerType: z.enum(['DOCUMENT_MISSING', 'APPROVAL_PENDING', 'SHIPMENT_DELAY', 'OTHER']).optional(),
  blockerNotes: z.string().optional()
});

const basePayloadSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  taskType: taskTypeEnum,
  status: taskStatusEnum.optional(),
  shipmentReferenceId: z.string().optional(),
  trackingNumber: z.string().optional(),
  originLocation: z.string().optional(),
  destinationLocation: z.string().optional(),
  transportMode: z.enum(['AIR', 'SEA', 'ROAD', 'MULTI_MODAL']).optional(),
  carrierProvider: z.string().optional(),
  estimatedArrivalDate: z.coerce.date().optional(),
  actualArrivalDate: z.coerce.date().optional(),
  responsibleDepartmentId: z.string().min(1),
  primaryAssigneeId: z.string().optional(),
  assignedTeamMemberIds: z.array(z.string()).default([]),
  supervisorId: z.string().optional(),
  externalPartner: z.string().optional(),
  startDate: z.coerce.date().optional(),
  expectedCompletionDate: z.coerce.date().optional(),
  actualCompletionDate: z.coerce.date().optional(),
  milestones: z.array(milestoneSchema).optional(),
  items: z.array(itemSchema).optional(),
  documents: z.array(documentSchema).optional(),
  dependencies: z.array(dependencySchema).optional(),
  dependsOnTaskId: z.string().optional(),
  blockedByType: z.enum(['DOCUMENT_MISSING', 'APPROVAL_PENDING', 'SHIPMENT_DELAY', 'OTHER']).optional(),
  blockedByNotes: z.string().optional(),
  riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
  delayReason: z.string().optional(),
  incidentReport: z.string().optional(),
  alertDelayHours: z.coerce.number().int().positive().optional(),
  alertTemperatureBreach: z.boolean().optional(),
  alertMissedMilestone: z.boolean().optional(),
  requiredTemperatureMin: z.coerce.number().optional(),
  requiredTemperatureMax: z.coerce.number().optional(),
  currentTemperature: z.coerce.number().optional(),
  monitoringDeviceId: z.string().optional(),
  outOfRangeAlert: z.boolean().optional()
});

const applyPayloadRefinement = (schema) => schema.superRefine((payload, ctx) => {
  const shipmentTypes = new Set(['SHIPMENT_HANDLING', 'CUSTOMS_CLEARANCE', 'TRANSPORT_DELIVERY', 'COLD_CHAIN_MONITORING', 'INVENTORY_MOVEMENT']);
  const cargoTypes = new Set(['SHIPMENT_HANDLING', 'CUSTOMS_CLEARANCE', 'TRANSPORT_DELIVERY', 'COLD_CHAIN_MONITORING', 'INVENTORY_MOVEMENT']);

  if (payload.taskType && shipmentTypes.has(payload.taskType) && !String(payload.shipmentReferenceId || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shipmentReferenceId'], message: 'Shipment reference ID is required for shipment-related task types' });
  }

  if (payload.taskType && cargoTypes.has(payload.taskType) && !(payload.items || []).length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['items'], message: 'At least one cargo item is required for cargo-related tasks' });
  }

  if (payload.taskType === 'COLD_CHAIN_MONITORING') {
    if (payload.requiredTemperatureMin === undefined || payload.requiredTemperatureMax === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requiredTemperatureMin'], message: 'Cold-chain tasks require a temperature range' });
    }
    if (payload.requiredTemperatureMin !== undefined && payload.requiredTemperatureMax !== undefined && payload.requiredTemperatureMin > payload.requiredTemperatureMax) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requiredTemperatureMax'], message: 'Temperature max must be greater than or equal to min' });
    }
  }

  if (payload.startDate && payload.expectedCompletionDate && payload.expectedCompletionDate < payload.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['expectedCompletionDate'], message: 'Expected completion date cannot be earlier than start date' });
  }

  if (payload.startDate && payload.actualCompletionDate && payload.actualCompletionDate < payload.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['actualCompletionDate'], message: 'Actual completion date cannot be earlier than start date' });
  }

  (payload.milestones || []).forEach((milestone, index) => {
    if (milestone.actualDate && milestone.actualDate < milestone.expectedDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['milestones', index, 'actualDate'], message: 'Milestone actual date cannot be earlier than expected date' });
    }
  });
});

const payloadSchema = applyPayloadRefinement(basePayloadSchema);
const updatePayloadSchema = applyPayloadRefinement(basePayloadSchema.partial());

module.exports = {
  list: z.object({
    query: z.object({
      search: z.string().optional(),
      status: taskStatusEnum.optional(),
      taskType: taskTypeEnum.optional(),
      riskLevel: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
      responsibleDepartmentId: z.string().optional(),
      assignedToId: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional()
    }).partial().passthrough()
  }),
  create: z.object({ body: payloadSchema }),
  update: z.object({ body: updatePayloadSchema }),
  status: z.object({ body: z.object({ status: taskStatusEnum, comment: z.string().optional(), delayReason: z.string().optional(), incidentReport: z.string().optional() }) }),
  addDocuments: z.object({ body: z.object({ documents: z.array(documentSchema).min(1) }) })
};
