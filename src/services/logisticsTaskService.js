const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const stateMachineService = require('./stateMachineService');
const auditService = require('./auditService');
const notificationService = require('./notificationService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const sortableFields = new Set(['createdAt', 'updatedAt', 'expectedCompletionDate', 'estimatedArrivalDate', 'riskLevel', 'status', 'title']);

const logisticsTaskInclude = {
  department: true,
  createdBy: { select: { id: true, fullName: true, email: true } },
  primaryAssignee: { select: { id: true, fullName: true, email: true } },
  supervisor: { select: { id: true, fullName: true, email: true } },
  teamMembers: {
    include: {
      user: { select: { id: true, fullName: true, email: true } }
    }
  },
  items: { orderBy: { createdAt: 'asc' } },
  documents: {
    orderBy: { uploadedAt: 'desc' },
    include: {
      uploadedBy: { select: { id: true, fullName: true, email: true } }
    }
  },
  milestones: { orderBy: { expectedDate: 'asc' } },
  dependencies: {
    orderBy: { createdAt: 'asc' },
    include: {
      dependsOnTask: {
        select: {
          id: true,
          title: true,
          status: true,
          taskType: true
        }
      }
    }
  },
  auditLogs: {
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      actor: { select: { id: true, fullName: true, email: true } }
    }
  }
};

const completionRequiredDocsByType = {
  SHIPMENT_HANDLING: ['INVOICE', 'PACKING_LIST', 'BILL_OF_LADING_AIRWAY_BILL'],
  CUSTOMS_CLEARANCE: ['CUSTOMS_DOCUMENT', 'CLEARANCE_CERTIFICATE'],
  TRANSPORT_DELIVERY: ['INVOICE', 'BILL_OF_LADING_AIRWAY_BILL'],
  COLD_CHAIN_MONITORING: ['INVOICE', 'PACKING_LIST', 'BILL_OF_LADING_AIRWAY_BILL'],
  INVENTORY_MOVEMENT: ['INVOICE', 'PACKING_LIST'],
  COMPLIANCE_INSPECTION: ['INSPECTION_REPORT']
};

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function resolveSortBy(sortBy) {
  return sortableFields.has(sortBy) ? sortBy : 'createdAt';
}

async function createAuditLog(tx, { logisticsTaskId, actorId, eventType, description, oldValues, newValues }) {
  await tx.logisticsTaskAuditLog.create({
    data: {
      logisticsTaskId,
      actorId: actorId || null,
      eventType,
      description: description || null,
      oldValues: oldValues || undefined,
      newValues: newValues || undefined
    }
  });
}

function checkRequiredDocumentsForCompletion(taskType, documents = []) {
  const requiredDocTypes = completionRequiredDocsByType[taskType] || [];
  const availableTypes = new Set((documents || []).map((document) => document.documentType));
  const missingTypes = requiredDocTypes.filter((documentType) => !availableTypes.has(documentType));
  return { requiredDocTypes, missingTypes };
}

function computeOutOfRangeAlert(payload) {
  const min = toNumber(payload.requiredTemperatureMin);
  const max = toNumber(payload.requiredTemperatureMax);
  const current = toNumber(payload.currentTemperature);
  if (min === null || max === null || current === null) return false;
  return current < min || current > max;
}

const logisticsTaskService = {
  buildWhere(auth, query = {}) {
    const where = { deletedAt: null, AND: [] };

    if (query.search) {
      where.AND.push({
        OR: [
          { title: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { shipmentReferenceId: { contains: query.search, mode: 'insensitive' } },
          { trackingNumber: { contains: query.search, mode: 'insensitive' } }
        ]
      });
    }

    if (query.status) where.status = query.status;
    if (query.taskType) where.taskType = query.taskType;
    if (query.riskLevel) where.riskLevel = query.riskLevel;
    if (query.responsibleDepartmentId) where.responsibleDepartmentId = query.responsibleDepartmentId;
    if (query.assignedToId) where.primaryAssigneeId = query.assignedToId;

    if (query.dateFrom || query.dateTo) {
      where.createdAt = {};
      if (query.dateFrom) where.createdAt.gte = new Date(query.dateFrom);
      if (query.dateTo) where.createdAt.lte = new Date(query.dateTo);
    }

    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isOperations(auth)) {
      if (accessControlService.isDepartmentHead(auth)) {
        where.AND.push({
          OR: [
            { responsibleDepartmentId: { in: auth.departmentIds } },
            { createdById: auth.userId },
            { primaryAssigneeId: auth.userId },
            { teamMembers: { some: { userId: auth.userId } } }
          ]
        });
      } else {
        where.AND.push({
          OR: [
            { createdById: auth.userId },
            { primaryAssigneeId: auth.userId },
            { teamMembers: { some: { userId: auth.userId } } }
          ]
        });
      }
    }

    if (!where.AND.length) delete where.AND;
    return where;
  },

  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const where = this.buildWhere(auth, query);
    const resolvedSortBy = resolveSortBy(sortBy);

    const [items, total] = await prisma.$transaction([
      prisma.logisticsTask.findMany({ where, include: logisticsTaskInclude, skip, take: limit, orderBy: { [resolvedSortBy]: sortOrder } }),
      prisma.logisticsTask.count({ where })
    ]);

    return paginated(items, total, page, limit);
  },

  async board(auth, query = {}) {
    const where = this.buildWhere(auth, query);
    const tasks = await prisma.logisticsTask.findMany({
      where,
      include: {
        department: { select: { id: true, name: true } },
        primaryAssignee: { select: { id: true, fullName: true } }
      },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }]
    });

    const bucketMap = {
      PENDING: 'pending',
      IN_PROGRESS: 'inProgress',
      AWAITING_CLEARANCE: 'awaitingClearance',
      IN_TRANSIT: 'inTransit',
      DELAYED: 'delayed',
      COMPLETED: 'completed',
      FAILED: 'failed'
    };

    return tasks.reduce((groups, task) => {
      const bucket = bucketMap[task.status];
      if (!bucket) return groups;
      groups[bucket].push({
        id: task.id,
        title: task.title,
        status: task.status,
        taskType: task.taskType,
        shipmentReferenceId: task.shipmentReferenceId,
        trackingNumber: task.trackingNumber,
        department: task.department,
        primaryAssignee: task.primaryAssignee,
        riskLevel: task.riskLevel,
        expectedCompletionDate: task.expectedCompletionDate
      });
      return groups;
    }, {
      pending: [],
      inProgress: [],
      awaitingClearance: [],
      inTransit: [],
      delayed: [],
      completed: [],
      failed: []
    });
  },

  async get(auth, id) {
    const task = await prisma.logisticsTask.findFirst({
      where: { id, deletedAt: null },
      include: logisticsTaskInclude
    });

    if (!task) throw new AppError('Logistics task not found', 404);

    if (!accessControlService.isGeneralManager(auth) && !accessControlService.isOperations(auth)) {
      const canAccess = task.createdById === auth.userId
        || task.primaryAssigneeId === auth.userId
        || (task.responsibleDepartmentId && auth.departmentIds.includes(task.responsibleDepartmentId))
        || (task.teamMembers || []).some((member) => member.userId === auth.userId);
      if (!canAccess) throw new AppError('You do not have access to this logistics task', 403);
    }

    const documentIds = [...new Set((task.documents || []).map((item) => item.documentId).filter(Boolean))];
    const documentRecords = documentIds.length
      ? await prisma.document.findMany({
        where: { id: { in: documentIds }, deletedAt: null },
        include: {
          uploadedBy: { select: { id: true, fullName: true, email: true } },
          approvedBy: { select: { id: true, fullName: true, email: true } }
        }
      })
      : [];

    const documentMap = new Map(documentRecords.map((document) => [document.id, document]));
    const hydratedDocuments = (task.documents || []).map((document) => ({
      ...document,
      linkedDocument: documentMap.get(document.documentId) || null
    }));

    return {
      ...task,
      documents: hydratedDocuments,
      documentRecords
    };
  },

  async create(auth, data, req) {
    if (!data.responsibleDepartmentId) throw new AppError('Responsible department is required', 400);

    if (!accessControlService.isGeneralManager(auth)
      && !accessControlService.isOperations(auth)
      && !accessControlService.hasDepartmentAccess(auth, data.responsibleDepartmentId)) {
      throw new AppError('You do not have permission to create logistics tasks for this department', 403);
    }

    const normalizedDocuments = Array.isArray(data.documents) ? data.documents : [];
    const documentIds = [...new Set(normalizedDocuments.map((item) => item.documentId).filter(Boolean))];
    const docs = documentIds.length
      ? await prisma.document.findMany({ where: { id: { in: documentIds }, deletedAt: null } })
      : [];

    const docMap = new Map(docs.map((doc) => [doc.id, doc]));
    normalizedDocuments.forEach((document) => {
      const linked = docMap.get(document.documentId);
      if (!linked) throw new AppError('One or more logistics documents are missing', 400);
      accessControlService.assertDocumentAccess(auth, linked);
    });

    const outOfRangeAlert = computeOutOfRangeAlert(data);

    const created = await prisma.$transaction(async (tx) => {
      const task = await tx.logisticsTask.create({
        data: {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          status: data.status || 'PENDING',
          shipmentReferenceId: data.shipmentReferenceId || null,
          trackingNumber: data.trackingNumber || null,
          originLocation: data.originLocation || null,
          destinationLocation: data.destinationLocation || null,
          transportMode: data.transportMode || null,
          carrierProvider: data.carrierProvider || null,
          estimatedArrivalDate: data.estimatedArrivalDate || null,
          actualArrivalDate: data.actualArrivalDate || null,
          responsibleDepartmentId: data.responsibleDepartmentId,
          primaryAssigneeId: data.primaryAssigneeId || null,
          supervisorId: data.supervisorId || null,
          externalPartner: data.externalPartner || null,
          assignedTeamSnapshot: (data.assignedTeamMemberIds || []).length ? { memberIds: data.assignedTeamMemberIds } : null,
          startDate: data.startDate || null,
          expectedCompletionDate: data.expectedCompletionDate || null,
          actualCompletionDate: data.actualCompletionDate || null,
          dependsOnTaskId: data.dependsOnTaskId || null,
          blockedByType: data.blockedByType || null,
          blockedByNotes: data.blockedByNotes || null,
          riskLevel: data.riskLevel || 'MEDIUM',
          delayReason: data.delayReason || null,
          incidentReport: data.incidentReport || null,
          alertDelayHours: data.alertDelayHours || null,
          alertTemperatureBreach: Boolean(data.alertTemperatureBreach),
          alertMissedMilestone: Boolean(data.alertMissedMilestone),
          requiredTemperatureMin: data.requiredTemperatureMin ?? null,
          requiredTemperatureMax: data.requiredTemperatureMax ?? null,
          currentTemperature: data.currentTemperature ?? null,
          monitoringDeviceId: data.monitoringDeviceId || null,
          outOfRangeAlert,
          createdById: auth.userId
        }
      });

      if (Array.isArray(data.items) && data.items.length) {
        await tx.logisticsTaskItem.createMany({
          data: data.items.map((item) => ({
            logisticsTaskId: task.id,
            itemName: item.itemName,
            quantity: item.quantity,
            unit: item.unit,
            weight: item.weight ?? null,
            volume: item.volume ?? null,
            temperatureRequirement: item.temperatureRequirement || null,
            specialHandlingNotes: item.specialHandlingNotes || null
          }))
        });
      }

      if (Array.isArray(data.milestones) && data.milestones.length) {
        await tx.logisticsTaskMilestone.createMany({
          data: data.milestones.map((milestone) => ({
            logisticsTaskId: task.id,
            name: milestone.name,
            expectedDate: milestone.expectedDate,
            actualDate: milestone.actualDate || null,
            status: milestone.status
          }))
        });
      }

      if ((data.assignedTeamMemberIds || []).length) {
        await tx.logisticsTaskTeamMember.createMany({
          data: [...new Set(data.assignedTeamMemberIds)].map((userId) => ({
            logisticsTaskId: task.id,
            userId
          })),
          skipDuplicates: true
        });
      }

      if (Array.isArray(data.dependencies) && data.dependencies.length) {
        await tx.logisticsTaskDependency.createMany({
          data: data.dependencies.map((dependency) => ({
            logisticsTaskId: task.id,
            dependsOnTaskId: dependency.dependsOnTaskId || null,
            blockerType: dependency.blockerType || null,
            blockerNotes: dependency.blockerNotes || null
          }))
        });
      }

      if (normalizedDocuments.length) {
        await tx.logisticsTaskDocument.createMany({
          data: normalizedDocuments.map((document) => {
            const linked = docMap.get(document.documentId);
            return {
              logisticsTaskId: task.id,
              documentId: document.documentId,
              documentType: document.documentType,
              fileName: linked?.fileName || null,
              mimeType: linked?.mimeType || null,
              fileSize: linked?.fileSize || null,
              uploadedById: auth.userId,
              metadata: {
                title: linked?.title || null,
                category: linked?.category || null
              }
            };
          })
        });
      }

      await createAuditLog(tx, {
        logisticsTaskId: task.id,
        actorId: auth.userId,
        eventType: 'TASK_CREATED',
        description: 'Logistics task created',
        newValues: {
          status: task.status,
          taskType: task.taskType,
          riskLevel: task.riskLevel
        }
      });

      await createAuditLog(tx, {
        logisticsTaskId: task.id,
        actorId: auth.userId,
        eventType: 'MILESTONES_UPDATED',
        description: 'Milestones initialized on task creation',
        newValues: data.milestones || []
      });

      await createAuditLog(tx, {
        logisticsTaskId: task.id,
        actorId: auth.userId,
        eventType: 'DOCUMENTS_UPLOADED',
        description: 'Task documents linked during task creation',
        newValues: normalizedDocuments
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.TASK_CREATED,
        entityType: 'LogisticsTask',
        entityId: task.id,
        newValues: task,
        req
      }, tx);

      return task;
    });

    if (created.primaryAssigneeId && created.primaryAssigneeId !== auth.userId) {
      await notificationService.create({
        userId: created.primaryAssigneeId,
        type: 'TASK_ASSIGNED',
        title: `Assigned logistics task: ${created.title}`,
        body: created.shipmentReferenceId || created.taskType,
        entityType: 'LogisticsTask',
        entityId: created.id
      });
    }

    return this.get(auth, created.id);
  },

  async update(auth, id, data, req) {
    const existing = await this.get(auth, id);

    if (normalizeStatus(existing.status) === 'COMPLETED' || normalizeStatus(existing.status) === 'FAILED') {
      throw new AppError('Completed or failed logistics tasks cannot be edited', 400);
    }

    if (!accessControlService.isGeneralManager(auth)
      && !accessControlService.isOperations(auth)
      && existing.createdById !== auth.userId
      && existing.primaryAssigneeId !== auth.userId) {
      throw new AppError('You do not have permission to update this logistics task', 403);
    }

    const mergedTaskType = data.taskType || existing.taskType;
    const mergedStatus = data.status || existing.status;
    if (data.status && data.status !== existing.status) {
      stateMachineService.assertTransition('LOGISTICS_TASK', existing.status, data.status);
    }

    const normalizedDocuments = Array.isArray(data.documents) ? data.documents : existing.documents;
    const requiredDocs = checkRequiredDocumentsForCompletion(mergedTaskType, normalizedDocuments);
    if (mergedStatus === 'COMPLETED' && requiredDocs.missingTypes.length) {
      throw new AppError(`Cannot complete task. Missing required documents: ${requiredDocs.missingTypes.join(', ')}`, 400);
    }

    const outOfRangeAlert = computeOutOfRangeAlert({
      requiredTemperatureMin: data.requiredTemperatureMin ?? existing.requiredTemperatureMin,
      requiredTemperatureMax: data.requiredTemperatureMax ?? existing.requiredTemperatureMax,
      currentTemperature: data.currentTemperature ?? existing.currentTemperature
    });

    await prisma.$transaction(async (tx) => {
      await tx.logisticsTask.update({
        where: { id },
        data: {
          title: data.title,
          description: data.description,
          taskType: data.taskType,
          status: data.status,
          shipmentReferenceId: data.shipmentReferenceId,
          trackingNumber: data.trackingNumber,
          originLocation: data.originLocation,
          destinationLocation: data.destinationLocation,
          transportMode: data.transportMode,
          carrierProvider: data.carrierProvider,
          estimatedArrivalDate: data.estimatedArrivalDate,
          actualArrivalDate: data.actualArrivalDate,
          responsibleDepartmentId: data.responsibleDepartmentId,
          primaryAssigneeId: data.primaryAssigneeId,
          supervisorId: data.supervisorId,
          externalPartner: data.externalPartner,
          assignedTeamSnapshot: data.assignedTeamMemberIds ? { memberIds: data.assignedTeamMemberIds } : undefined,
          startDate: data.startDate,
          expectedCompletionDate: data.expectedCompletionDate,
          dependsOnTaskId: data.dependsOnTaskId,
          blockedByType: data.blockedByType,
          blockedByNotes: data.blockedByNotes,
          riskLevel: data.riskLevel,
          delayReason: data.delayReason,
          incidentReport: data.incidentReport,
          alertDelayHours: data.alertDelayHours,
          alertTemperatureBreach: data.alertTemperatureBreach,
          alertMissedMilestone: data.alertMissedMilestone,
          requiredTemperatureMin: data.requiredTemperatureMin,
          requiredTemperatureMax: data.requiredTemperatureMax,
          currentTemperature: data.currentTemperature,
          monitoringDeviceId: data.monitoringDeviceId,
          outOfRangeAlert,
          actualCompletionDate: mergedStatus === 'COMPLETED'
            ? (data.actualCompletionDate || new Date())
            : data.actualCompletionDate
        }
      });

      if (Array.isArray(data.items)) {
        await tx.logisticsTaskItem.deleteMany({ where: { logisticsTaskId: id } });
        if (data.items.length) {
          await tx.logisticsTaskItem.createMany({
            data: data.items.map((item) => ({
              logisticsTaskId: id,
              itemName: item.itemName,
              quantity: item.quantity,
              unit: item.unit,
              weight: item.weight ?? null,
              volume: item.volume ?? null,
              temperatureRequirement: item.temperatureRequirement || null,
              specialHandlingNotes: item.specialHandlingNotes || null
            }))
          });
        }
      }

      if (Array.isArray(data.milestones)) {
        await tx.logisticsTaskMilestone.deleteMany({ where: { logisticsTaskId: id } });
        if (data.milestones.length) {
          await tx.logisticsTaskMilestone.createMany({
            data: data.milestones.map((milestone) => ({
              logisticsTaskId: id,
              name: milestone.name,
              expectedDate: milestone.expectedDate,
              actualDate: milestone.actualDate || null,
              status: milestone.status
            }))
          });
        }
      }

      if (Array.isArray(data.assignedTeamMemberIds)) {
        await tx.logisticsTaskTeamMember.deleteMany({ where: { logisticsTaskId: id } });
        if (data.assignedTeamMemberIds.length) {
          await tx.logisticsTaskTeamMember.createMany({
            data: [...new Set(data.assignedTeamMemberIds)].map((userId) => ({ logisticsTaskId: id, userId })),
            skipDuplicates: true
          });
        }
      }

      if (Array.isArray(data.dependencies)) {
        await tx.logisticsTaskDependency.deleteMany({ where: { logisticsTaskId: id } });
        if (data.dependencies.length) {
          await tx.logisticsTaskDependency.createMany({
            data: data.dependencies.map((dependency) => ({
              logisticsTaskId: id,
              dependsOnTaskId: dependency.dependsOnTaskId || null,
              blockerType: dependency.blockerType || null,
              blockerNotes: dependency.blockerNotes || null
            }))
          });
        }
      }

      if (Array.isArray(data.documents)) {
        const documentIds = [...new Set(data.documents.map((item) => item.documentId).filter(Boolean))];
        const docs = documentIds.length
          ? await tx.document.findMany({ where: { id: { in: documentIds }, deletedAt: null } })
          : [];
        const docMap = new Map(docs.map((doc) => [doc.id, doc]));

        data.documents.forEach((document) => {
          const linked = docMap.get(document.documentId);
          if (!linked) throw new AppError('One or more logistics documents are missing', 400);
          accessControlService.assertDocumentAccess(auth, linked);
        });

        await tx.logisticsTaskDocument.deleteMany({ where: { logisticsTaskId: id } });
        if (data.documents.length) {
          await tx.logisticsTaskDocument.createMany({
            data: data.documents.map((document) => {
              const linked = docMap.get(document.documentId);
              return {
                logisticsTaskId: id,
                documentId: document.documentId,
                documentType: document.documentType,
                fileName: linked?.fileName || null,
                mimeType: linked?.mimeType || null,
                fileSize: linked?.fileSize || null,
                uploadedById: auth.userId,
                metadata: {
                  title: linked?.title || null,
                  category: linked?.category || null
                }
              };
            })
          });
        }
      }

      await createAuditLog(tx, {
        logisticsTaskId: id,
        actorId: auth.userId,
        eventType: 'TASK_UPDATED',
        description: 'Logistics task updated',
        oldValues: existing,
        newValues: data
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.TASK_UPDATED,
        entityType: 'LogisticsTask',
        entityId: id,
        oldValues: existing,
        newValues: data,
        req
      }, tx);
    });

    return this.get(auth, id);
  },

  async updateStatus(auth, id, status, comment, delayReason, incidentReport, req) {
    const existing = await this.get(auth, id);

    if (!accessControlService.isGeneralManager(auth)
      && !accessControlService.isOperations(auth)
      && existing.primaryAssigneeId !== auth.userId
      && existing.createdById !== auth.userId
      && existing.supervisorId !== auth.userId) {
      throw new AppError('You do not have permission to change logistics task status', 403);
    }

    stateMachineService.assertTransition('LOGISTICS_TASK', existing.status, status);

    const requiredDocs = checkRequiredDocumentsForCompletion(existing.taskType, existing.documents);
    if (status === 'COMPLETED' && requiredDocs.missingTypes.length) {
      throw new AppError(`Cannot complete task. Missing required documents: ${requiredDocs.missingTypes.join(', ')}`, 400);
    }

    await prisma.$transaction(async (tx) => {
      await tx.logisticsTask.update({
        where: { id },
        data: {
          status,
          delayReason: delayReason || existing.delayReason,
          incidentReport: incidentReport || existing.incidentReport,
          actualCompletionDate: status === 'COMPLETED' ? new Date() : existing.actualCompletionDate
        }
      });

      await createAuditLog(tx, {
        logisticsTaskId: id,
        actorId: auth.userId,
        eventType: 'STATUS_CHANGED',
        description: `Status changed to ${status}`,
        oldValues: { status: existing.status },
        newValues: { status, comment: comment || null, delayReason: delayReason || null, incidentReport: incidentReport || null }
      });

      if (status === 'DELAYED') {
        await createAuditLog(tx, {
          logisticsTaskId: id,
          actorId: auth.userId,
          eventType: 'DELAY_REPORTED',
          description: 'Delay reason captured for logistics task',
          newValues: { delayReason: delayReason || null }
        });
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.TASK_UPDATED,
        entityType: 'LogisticsTask',
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status, comment: comment || null },
        req
      }, tx);
    });

    if (existing.primaryAssigneeId && existing.primaryAssigneeId !== auth.userId) {
      await notificationService.create({
        userId: existing.primaryAssigneeId,
        type: 'TASK_ASSIGNED',
        title: `Logistics task status updated: ${existing.title}`,
        body: status,
        entityType: 'LogisticsTask',
        entityId: id
      });
    }

    return this.get(auth, id);
  },

  async addDocuments(auth, id, documents, req) {
    const existing = await this.get(auth, id);

    if (normalizeStatus(existing.status) === 'COMPLETED' || normalizeStatus(existing.status) === 'FAILED') {
      throw new AppError('Cannot add documents to completed or failed logistics task', 400);
    }

    if (!accessControlService.isGeneralManager(auth)
      && !accessControlService.isOperations(auth)
      && existing.createdById !== auth.userId
      && existing.primaryAssigneeId !== auth.userId
      && existing.supervisorId !== auth.userId) {
      throw new AppError('You do not have permission to add logistics task documents', 403);
    }

    const normalizedDocuments = Array.isArray(documents) ? documents : [];
    const documentIds = [...new Set(normalizedDocuments.map((item) => item.documentId).filter(Boolean))];
    const docs = documentIds.length
      ? await prisma.document.findMany({ where: { id: { in: documentIds }, deletedAt: null } })
      : [];
    const docMap = new Map(docs.map((doc) => [doc.id, doc]));

    normalizedDocuments.forEach((document) => {
      const linked = docMap.get(document.documentId);
      if (!linked) throw new AppError('One or more logistics documents are missing', 400);
      accessControlService.assertDocumentAccess(auth, linked);
    });

    await prisma.$transaction(async (tx) => {
      await tx.logisticsTaskDocument.createMany({
        data: normalizedDocuments.map((document) => {
          const linked = docMap.get(document.documentId);
          return {
            logisticsTaskId: id,
            documentId: document.documentId,
            documentType: document.documentType,
            fileName: linked?.fileName || null,
            mimeType: linked?.mimeType || null,
            fileSize: linked?.fileSize || null,
            uploadedById: auth.userId,
            metadata: {
              title: linked?.title || null,
              category: linked?.category || null,
              appended: true
            }
          };
        })
      });

      await createAuditLog(tx, {
        logisticsTaskId: id,
        actorId: auth.userId,
        eventType: 'DOCUMENTS_UPLOADED',
        description: 'Additional logistics documents uploaded',
        newValues: normalizedDocuments
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.TASK_UPDATED,
        entityType: 'LogisticsTask',
        entityId: id,
        newValues: { documents: normalizedDocuments },
        req
      }, tx);
    });

    return this.get(auth, id);
  }
};

module.exports = logisticsTaskService;
