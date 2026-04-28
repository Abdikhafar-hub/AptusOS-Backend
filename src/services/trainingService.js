const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { parsePagination, paginated } = require('../utils/pagination');
const accessControlService = require('./accessControlService');
const notificationService = require('./notificationService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const timelineService = require('./timelineService');
const uploadService = require('../uploads/uploadService');

const safeDepartmentSelect = {
  id: true,
  name: true,
  slug: true,
  headId: true
};

const participantInclude = {
  employee: {
    select: {
      id: true,
      fullName: true,
      email: true,
      departmentId: true,
      department: { select: safeDepartmentSelect }
    }
  }
};

const safeTrainingInclude = {
  createdBy: { select: { id: true, fullName: true, email: true } },
  participants: {
    include: participantInclude
  }
};

const normalizeSearch = (value) => (typeof value === 'string' ? value.trim() : '');
const uniqueIds = (values = []) => [...new Set((values || []).filter(Boolean))];
const TRAINING_METADATA_MARKER = '\n\n[TRAINING_META]';

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
};

const toStringArray = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
      const parsed = safeJsonParse(trimmed, []);
      if (Array.isArray(parsed)) return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
    return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
  }
  return [];
};

const toBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  }
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
};

const toNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const extractTrainingMetadata = (description) => {
  const raw = String(description || '');
  const markerIndex = raw.lastIndexOf(TRAINING_METADATA_MARKER);
  if (markerIndex === -1) return { cleanDescription: raw || null, metadata: {} };

  const cleanDescription = raw.slice(0, markerIndex).trim();
  const metadataText = raw.slice(markerIndex + TRAINING_METADATA_MARKER.length).trim();
  const metadata = safeJsonParse(metadataText, {});
  return {
    cleanDescription: cleanDescription || null,
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  };
};

const buildDescriptionWithMetadata = (description, metadata = {}) => {
  const baseDescription = String(description || '').trim();
  const serializedMetadata = JSON.stringify(metadata || {});
  return `${baseDescription}${TRAINING_METADATA_MARKER}${serializedMetadata}`;
};

const normalizeTrainingType = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'SOFT_SKILLS') return 'OTHER';
  if (['COMPLIANCE', 'SOP', 'SAFETY', 'SALES', 'HR', 'TECHNICAL', 'ONBOARDING', 'OTHER'].includes(normalized)) {
    return normalized;
  }
  return 'OTHER';
};

const normalizeTrainingCreateInput = (data = {}) => {
  const trainingTypeLabel = String(data.trainingTypeLabel || data.trainingType || 'OTHER').trim().toUpperCase();
  return {
    title: String(data.title || '').trim(),
    description: String(data.description || '').trim(),
    trainingType: normalizeTrainingType(trainingTypeLabel),
    trainingTypeLabel,
    startDateTime: data.startDateTime ? new Date(data.startDateTime) : (data.trainingDate ? new Date(data.trainingDate) : null),
    endDateTime: data.endDateTime ? new Date(data.endDateTime) : null,
    trainingMode: String(data.trainingMode || 'IN_PERSON').trim().toUpperCase(),
    location: String(data.location || '').trim(),
    meetingLink: String(data.meetingLink || '').trim(),
    durationHours: toNumber(data.durationHours),
    capacity: toNumber(data.capacity),
    trainerType: String(data.trainerType || 'INTERNAL').trim().toUpperCase(),
    trainerName: String(data.trainerName || '').trim(),
    trainerContact: String(data.trainerContact || '').trim(),
    trainerOrganization: String(data.trainerOrganization || '').trim(),
    status: String(data.status || 'SCHEDULED').trim().toUpperCase(),
    attendanceRequired: toBoolean(data.attendanceRequired, false),
    certificationProvided: toBoolean(data.certificationProvided, false),
    assessmentRequired: toBoolean(data.assessmentRequired, false),
    sendReminder: toBoolean(data.sendReminder, false),
    notesInstructions: String(data.notesInstructions || '').trim(),
    departmentId: String(data.departmentId || '').trim() || null,
    participantIds: toStringArray(data.participantIds),
    participantDepartmentIds: toStringArray(data.participantDepartmentIds),
    participantRoleIds: toStringArray(data.participantRoleIds)
  };
};

const hydrateTrainingRecord = (training) => {
  const { cleanDescription, metadata } = extractTrainingMetadata(training.description);
  return {
    ...training,
    description: cleanDescription,
    ...metadata,
    participantCount: training.participants?.length || 0,
    completionCount: (training.participants || []).filter((participant) => participant.status === 'COMPLETED').length
  };
};

const trainingService = {
  async list(auth, query = {}) {
    const { page, limit, skip, sortBy, sortOrder } = parsePagination(query);
    const search = normalizeSearch(query.search);
    const normalizedTrainingType = query.trainingType ? normalizeTrainingType(query.trainingType) : null;
    const where = {
      deletedAt: null,
      ...(normalizedTrainingType ? { trainingType: normalizedTrainingType } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(String(query.trainingType || '').trim().toUpperCase() === 'SOFT_SKILLS'
        ? { description: { contains: '"trainingTypeLabel":"SOFT_SKILLS"' } }
        : {}),
      ...(query.dateFrom || query.dateTo ? {
        trainingDate: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {})
        }
      } : {})
    };

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { trainerName: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (query.status) {
      where.participants = { some: { status: query.status } };
    }

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) where.departmentId = { in: auth.departmentIds };
      else where.participants = { some: { employeeId: auth.userId } };
    }

    const [items, total] = await prisma.$transaction([
      prisma.training.findMany({
        where,
        include: safeTrainingInclude,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder }
      }),
      prisma.training.count({ where })
    ]);

    return paginated(items.map((item) => hydrateTrainingRecord(item)), total, page, limit);
  },

  async get(auth, id) {
    const training = await prisma.training.findFirst({
      where: { id, deletedAt: null },
      include: safeTrainingInclude
    });
    if (!training) throw new AppError('Training not found', 404);

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      if (accessControlService.isDepartmentHead(auth)) {
        if (training.departmentId && !auth.departmentIds.includes(training.departmentId)) {
          throw new AppError('You do not have access to this training', 403);
        }
      } else if (!training.participants.some((participant) => participant.employeeId === auth.userId)) {
        throw new AppError('You do not have access to this training', 403);
      }
    }

    const [timeline, comments, certificates] = await Promise.all([
      timelineService.getTimeline('TRAINING', id),
      prisma.comment.findMany({
        where: { entityType: 'TRAINING', entityId: id, deletedAt: null },
        include: { author: { select: { id: true, fullName: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      }),
      prisma.document.findMany({
        where: {
          category: 'TRAINING_CERTIFICATE',
          id: {
            in: training.participants
              .map((participant) => participant.certificateDocumentId)
              .filter(Boolean)
          }
        }
      })
    ]);

    const certificateMap = new Map(certificates.map((document) => [document.id, document]));

    const hydratedTraining = hydrateTrainingRecord(training);
    return {
      ...hydratedTraining,
      participants: training.participants.map((participant) => ({
        ...participant,
        certificateDocument: participant.certificateDocumentId ? certificateMap.get(participant.certificateDocumentId) || null : null
      })),
      comments,
      timeline
    };
  },

  async create(auth, data, files = [], req) {
    const input = normalizeTrainingCreateInput(data);
    if (!input.title || input.title.length < 3) throw new AppError('Training title is required', 422);
    if (!input.description || input.description.length < 3) throw new AppError('Training description is required', 422);
    if (!input.startDateTime || Number.isNaN(input.startDateTime.getTime())) throw new AppError('Start date and time is required', 422);
    if (input.endDateTime && Number.isNaN(input.endDateTime.getTime())) throw new AppError('End date and time is invalid', 422);
    if (input.endDateTime && input.endDateTime <= input.startDateTime) throw new AppError('End date and time must be after start date and time', 400);
    if (['IN_PERSON', 'HYBRID'].includes(input.trainingMode) && !input.location) {
      throw new AppError('Location is required for in-person or hybrid training', 422);
    }
    if (['VIRTUAL', 'HYBRID'].includes(input.trainingMode) && !input.meetingLink) {
      throw new AppError('Meeting link is required for virtual or hybrid training', 422);
    }
    if (input.meetingLink && !/^https?:\/\//i.test(input.meetingLink)) {
      throw new AppError('Meeting link must be a valid URL starting with http:// or https://', 422);
    }
    if (input.capacity !== null && input.capacity < 1) throw new AppError('Capacity must be at least 1', 422);

    const participantIds = new Set(input.participantIds);
    if (input.departmentId) input.participantDepartmentIds.push(input.departmentId);

    const [departmentUsers, roleUsers] = await Promise.all([
      input.participantDepartmentIds.length
        ? prisma.user.findMany({
          where: { departmentId: { in: uniqueIds(input.participantDepartmentIds) }, isActive: true, deletedAt: null },
          select: { id: true }
        })
        : [],
      input.participantRoleIds.length
        ? prisma.user.findMany({
          where: { roleId: { in: uniqueIds(input.participantRoleIds) }, isActive: true, deletedAt: null },
          select: { id: true }
        })
        : []
    ]);

    [...departmentUsers, ...roleUsers].forEach((user) => participantIds.add(user.id));

    if (input.capacity !== null && participantIds.size > input.capacity) {
      throw new AppError(`Selected participants (${participantIds.size}) exceed capacity (${input.capacity})`, 400);
    }

    const materialFiles = Array.isArray(files) ? files.filter(Boolean) : [];
    const uploadedMaterials = materialFiles.length
      ? await uploadService.uploadMultipleFiles(materialFiles, 'trainings/materials')
      : [];

    const training = await prisma.$transaction(async (tx) => {
      const metadata = {
        trainingTypeLabel: input.trainingTypeLabel,
        trainingMode: input.trainingMode,
        location: input.location || null,
        meetingLink: input.meetingLink || null,
        durationHours: input.durationHours,
        capacity: input.capacity,
        startDateTime: input.startDateTime ? input.startDateTime.toISOString() : null,
        endDateTime: input.endDateTime ? input.endDateTime.toISOString() : null,
        trainerType: input.trainerType,
        trainerContact: input.trainerContact || null,
        trainerOrganization: input.trainerOrganization || null,
        status: input.status,
        attendanceRequired: input.attendanceRequired,
        certificationProvided: input.certificationProvided,
        assessmentRequired: input.assessmentRequired,
        sendReminder: input.sendReminder,
        notesInstructions: input.notesInstructions || null,
        participantSelection: {
          departments: uniqueIds(input.participantDepartmentIds),
          roles: uniqueIds(input.participantRoleIds)
        },
        materials: []
      };

      const created = await tx.training.create({
        data: {
          title: input.title,
          description: buildDescriptionWithMetadata(input.description, metadata),
          trainingDate: input.startDateTime,
          trainerName: input.trainerName || null,
          trainingType: input.trainingType,
          departmentId: input.departmentId,
          createdById: auth.userId,
          participants: {
            create: [...participantIds].map((employeeId) => ({ employeeId }))
          }
        },
        include: safeTrainingInclude
      });

      const materialDocuments = [];
      for (let index = 0; index < uploadedMaterials.length; index += 1) {
        const uploaded = uploadedMaterials[index];
        const sourceFile = materialFiles[index];
        const document = await tx.document.create({
          data: {
            title: `${input.title} - material ${index + 1}`,
            description: 'Training supporting material',
            category: 'HR_DOCUMENT',
            documentType: 'TRAINING_MATERIAL',
            ownerType: 'HR',
            ownerId: null,
            departmentId: input.departmentId || null,
            visibility: 'COMPANY_INTERNAL',
            status: 'APPROVED',
            approvedAt: new Date(),
            approvedById: auth.userId,
            uploadedById: auth.userId,
            fileUrl: uploaded.fileUrl,
            cloudinaryPublicId: uploaded.cloudinaryPublicId,
            fileName: uploaded.fileName || sourceFile?.originalname,
            mimeType: uploaded.mimeType || sourceFile?.mimetype || 'application/octet-stream',
            fileSize: uploaded.fileSize || sourceFile?.size || 0
          }
        });
        materialDocuments.push(document);
        await auditService.log({
          actorId: auth.userId,
          action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
          entityType: 'Document',
          entityId: document.id,
          newValues: document,
          req
        }, tx);
      }

      if (materialDocuments.length) {
        const existingMetadata = extractTrainingMetadata(created.description).metadata;
        const mergedMetadata = {
          ...existingMetadata,
          materials: materialDocuments.map((document) => ({
            documentId: document.id,
            title: document.title,
            fileName: document.fileName,
            fileUrl: document.fileUrl,
            mimeType: document.mimeType,
            fileSize: document.fileSize
          }))
        };
        await tx.training.update({
          where: { id: created.id },
          data: { description: buildDescriptionWithMetadata(input.description, mergedMetadata) }
        });
      }

      await auditService.log({ actorId: auth.userId, action: AUDIT_ACTIONS.USER_UPDATED, entityType: 'Training', entityId: created.id, newValues: created, req }, tx);
      return created;
    });

    if (participantIds.size) {
      await notificationService.createMany(
        [...participantIds],
        {
          type: 'TRAINING_ASSIGNED',
          title: training.title,
          body: input.sendReminder
            ? `${input.description} Reminder is enabled for this training.`
            : input.description,
          entityType: 'Training',
          entityId: training.id
        }
      );
    }

    return this.get(auth, training.id);
  },

  async updateParticipant(auth, trainingId, participantId, data, req) {
    const participant = await prisma.trainingParticipant.findUnique({
      where: { trainingId_employeeId: { trainingId, employeeId: participantId } },
      include: {
        training: {
          select: {
            id: true,
            title: true,
            description: true,
            trainingDate: true,
            trainerName: true,
            trainingType: true,
            departmentId: true,
            createdById: true,
            createdAt: true,
            updatedAt: true
          }
        }
      }
    });
    if (!participant) throw new AppError('Training participant not found', 404);

    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth) && auth.userId !== participantId) {
      throw new AppError('You do not have permission to update this training attendance record', 403);
    }

    const updated = await prisma.trainingParticipant.update({
      where: { id: participant.id },
      data: {
        status: data.status,
        attendedAt: ['ATTENDED', 'COMPLETED'].includes(data.status) ? new Date() : participant.attendedAt,
        completedAt: data.status === 'COMPLETED' ? new Date() : participant.completedAt,
        certificateDocumentId: data.certificateDocumentId || participant.certificateDocumentId
      }
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'TrainingParticipant',
      entityId: updated.id,
      oldValues: { status: participant.status },
      newValues: updated,
      req
    });

    return updated;
  },

  async uploadCertificate(auth, trainingId, participantId, file, data, req) {
    if (!file) throw new AppError('A file upload is required', 400);

    const participant = await prisma.trainingParticipant.findUnique({
      where: { trainingId_employeeId: { trainingId, employeeId: participantId } },
      include: {
        training: {
          select: {
            id: true,
            title: true,
            trainingType: true,
            departmentId: true
          }
        },
        employee: {
          select: {
            id: true,
            fullName: true,
            email: true,
            departmentId: true
          }
        }
      }
    });
    if (!participant) throw new AppError('Training participant not found', 404);
    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only HR or General Manager can upload training certificates', 403);
    }
    if (!['ATTENDED', 'COMPLETED'].includes(participant.status)) {
      throw new AppError('Certificates can only be uploaded for attended or completed training participants', 400);
    }

    const uploaded = await uploadService.uploadSingleFile(file, 'trainings/certificates');
    const result = await prisma.$transaction(async (tx) => {
      const document = await tx.document.create({
        data: {
          title: data.title || `${participant.employee.fullName} - ${participant.training.title} certificate`,
          description: data.description || `Training certificate for ${participant.training.title}`,
          category: 'TRAINING_CERTIFICATE',
          documentType: 'TRAINING_CERTIFICATE',
          ownerType: 'USER',
          ownerId: participant.employeeId,
          departmentId: participant.employee.departmentId || participant.training.departmentId,
          visibility: data.visibility || 'PRIVATE',
          status: 'APPROVED',
          approvedAt: new Date(),
          approvedById: auth.userId,
          uploadedById: auth.userId,
          ...uploaded
        }
      });

      const updatedParticipant = await tx.trainingParticipant.update({
        where: { id: participant.id },
        data: {
          certificateDocumentId: document.id
        }
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
        entityType: 'Document',
        entityId: document.id,
        newValues: document,
        req
      }, tx);
      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.USER_UPDATED,
        entityType: 'TrainingParticipant',
        entityId: updatedParticipant.id,
        oldValues: { certificateDocumentId: participant.certificateDocumentId },
        newValues: { certificateDocumentId: document.id },
        req
      }, tx);

      return { document, participant: updatedParticipant };
    });

    await notificationService.create({
      userId: participant.employeeId,
      type: 'TRAINING_ASSIGNED',
      title: 'Training certificate uploaded',
      body: participant.training.title,
      entityType: 'Training',
      entityId: trainingId
    });

    return result;
  },

  async notifyParticipants(auth, trainingId, data, req) {
    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('You do not have permission to notify training participants', 403);
    }

    const training = await prisma.training.findFirst({
      where: { id: trainingId, deletedAt: null },
      include: {
        participants: {
          include: participantInclude
        }
      }
    });
    if (!training) throw new AppError('Training not found', 404);

    const requestedParticipantIds = uniqueIds(data.participantIds);
    const recipients = training.participants.filter((participant) => {
      if (!requestedParticipantIds.length) return true;
      return requestedParticipantIds.includes(participant.employeeId);
    });

    if (!recipients.length) throw new AppError('No matching training participants were found to notify', 400);

    const body = data.message || training.description || `Reminder for ${training.title}`;

    await notificationService.createMany(
      recipients.map((participant) => participant.employeeId),
      {
        type: 'TRAINING_ASSIGNED',
        title: training.title,
        body,
        entityType: 'Training',
        entityId: trainingId
      }
    );

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.USER_UPDATED,
      entityType: 'Training',
      entityId: trainingId,
      newValues: {
        notifiedParticipantIds: recipients.map((participant) => participant.employeeId),
        message: body
      },
      req
    });

    return {
      trainingId,
      notifiedCount: recipients.length,
      participantIds: recipients.map((participant) => participant.employeeId),
      message: body
    };
  },

  async metrics(auth) {
    if (!accessControlService.isHr(auth) && !accessControlService.isGeneralManager(auth)) {
      throw new AppError('You do not have access to training metrics', 403);
    }

    const [upcoming, byType, completion] = await prisma.$transaction([
      prisma.training.count({ where: { deletedAt: null, trainingDate: { gte: new Date() } } }),
      prisma.training.groupBy({ by: ['trainingType'], where: { deletedAt: null }, _count: true }),
      prisma.trainingParticipant.groupBy({ by: ['status'], _count: true })
    ]);

    return { upcoming, byType, completion };
  }
};

module.exports = trainingService;
