const { AUDIT_ACTIONS } = require('../constants/auditActions');
const { parseUserAgent } = require('../utils/userAgent');

const AUDIT_CATEGORIES = Object.freeze({
  AUTHENTICATION: 'Authentication',
  COMMUNICATION: 'Communication',
  HR: 'HR',
  FINANCE: 'Finance',
  OPERATIONS: 'Operations',
  COMPLIANCE: 'Compliance',
  OTHER: 'Other'
});

const CATEGORY_ACTIONS = Object.freeze({
  [AUDIT_CATEGORIES.AUTHENTICATION]: [
    AUDIT_ACTIONS.USER_LOGIN,
    AUDIT_ACTIONS.USER_FAILED_LOGIN,
    AUDIT_ACTIONS.USER_LOGOUT
  ],
  [AUDIT_CATEGORIES.COMMUNICATION]: [
    AUDIT_ACTIONS.MESSAGE_SENT,
    AUDIT_ACTIONS.MESSAGE_READ,
    AUDIT_ACTIONS.MESSAGE_EMAIL_DELIVERED,
    AUDIT_ACTIONS.MESSAGE_EMAIL_FAILED,
    AUDIT_ACTIONS.ANNOUNCEMENT_PUBLISHED,
    AUDIT_ACTIONS.COMMENT_ADDED
  ],
  [AUDIT_CATEGORIES.HR]: [
    AUDIT_ACTIONS.USER_CREATED,
    AUDIT_ACTIONS.USER_UPDATED,
    AUDIT_ACTIONS.USER_DEACTIVATED,
    AUDIT_ACTIONS.ROLE_CHANGED,
    AUDIT_ACTIONS.DEPARTMENT_CHANGED,
    AUDIT_ACTIONS.LEAVE_REQUESTED,
    AUDIT_ACTIONS.LEAVE_APPROVED,
    AUDIT_ACTIONS.LEAVE_UPDATED,
    AUDIT_ACTIONS.LEAVE_CREATED_FOR_STAFF,
    AUDIT_ACTIONS.STAFF_ONBOARDING_EMAIL_SENT,
    AUDIT_ACTIONS.STAFF_ONBOARDING_EMAIL_FAILED,
    AUDIT_ACTIONS.STAFF_CREDENTIALS_RESENT,
    AUDIT_ACTIONS.STAFF_CREDENTIALS_RESEND_FAILED
  ],
  [AUDIT_CATEGORIES.FINANCE]: [
    AUDIT_ACTIONS.FINANCE_REQUEST_CREATED,
    AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED,
    AUDIT_ACTIONS.FINANCE_REQUEST_PAID,
    AUDIT_ACTIONS.PAYROLL_UPDATED
  ],
  [AUDIT_CATEGORIES.OPERATIONS]: [
    AUDIT_ACTIONS.TASK_CREATED,
    AUDIT_ACTIONS.TASK_UPDATED,
    AUDIT_ACTIONS.DOCUMENT_UPLOADED,
    AUDIT_ACTIONS.DOCUMENT_APPROVED,
    AUDIT_ACTIONS.DOCUMENT_REJECTED
  ],
  [AUDIT_CATEGORIES.COMPLIANCE]: [
    AUDIT_ACTIONS.APPROVAL_CREATED,
    AUDIT_ACTIONS.APPROVAL_APPROVED,
    AUDIT_ACTIONS.APPROVAL_REJECTED,
    AUDIT_ACTIONS.COMPLIANCE_UPDATED,
    AUDIT_ACTIONS.SETTINGS_UPDATED
  ]
});

function titleCaseFromConstant(value) {
  return String(value || '')
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (match) => match.toUpperCase())
    .trim();
}

function extractAuditKind(entry) {
  const kind = entry?.newValues?.auditKind;
  if (typeof kind === 'string' && kind.trim()) return kind.trim();
  const original = entry?.newValues?.originalAuditAction;
  if (typeof original === 'string' && original.trim()) return original.trim();
  return null;
}

function resolveCategory(action, auditKind) {
  // Allow synthetic kinds to drive categorization without new DB enum values.
  if (auditKind && String(auditKind).startsWith('PASSWORD_')) return AUDIT_CATEGORIES.AUTHENTICATION;

  for (const [category, actions] of Object.entries(CATEGORY_ACTIONS)) {
    if (actions.includes(action)) return category;
  }

  return AUDIT_CATEGORIES.OTHER;
}

function resolveActionLabel(entry) {
  const auditKind = extractAuditKind(entry);
  if (auditKind === 'PASSWORD_CHANGED') return 'Password changed';
  if (auditKind === 'PASSWORD_RESET_REQUESTED') return 'Password reset requested';
  if (auditKind === 'PASSWORD_RESET_COMPLETED') return 'Password reset completed';
  if (auditKind === 'PASSWORD_SETUP_COMPLETED') return 'Password setup completed';

  switch (entry.action) {
    case AUDIT_ACTIONS.USER_LOGIN:
      return 'Logged in';
    case AUDIT_ACTIONS.USER_FAILED_LOGIN:
      return 'Login failed';
    case AUDIT_ACTIONS.USER_LOGOUT:
      return 'Logged out';
    case AUDIT_ACTIONS.USER_CREATED:
      return 'Created staff member';
    case AUDIT_ACTIONS.MESSAGE_SENT:
      return 'Sent email';
    case AUDIT_ACTIONS.MESSAGE_EMAIL_DELIVERED:
      return 'Email delivered';
    case AUDIT_ACTIONS.MESSAGE_EMAIL_FAILED:
      return 'Email failed';
    case AUDIT_ACTIONS.ROLE_CHANGED:
      return 'Changed role';
    case AUDIT_ACTIONS.DEPARTMENT_CHANGED:
      return 'Changed department';
    case AUDIT_ACTIONS.APPROVAL_APPROVED:
      return 'Approved request';
    case AUDIT_ACTIONS.APPROVAL_REJECTED:
      return 'Rejected request';
    case AUDIT_ACTIONS.DOCUMENT_UPLOADED:
      return 'Uploaded document';
    case AUDIT_ACTIONS.LEAVE_CREATED_FOR_STAFF:
      return 'Created staff leave';
    default:
      return titleCaseFromConstant(entry.action);
  }
}

async function buildEntityMaps(items, prisma) {
  const idsByType = new Map();
  const referencedUserIds = new Set();

  for (const item of items) {
    if (item?.entityType && item?.entityId) {
      const set = idsByType.get(item.entityType) || new Set();
      set.add(item.entityId);
      idsByType.set(item.entityType, set);
    }

    // Pull recipients from email/message audit metadata for business-friendly display.
    const toUserIds = item?.newValues?.toUserIds;
    if (Array.isArray(toUserIds)) {
      for (const id of toUserIds) {
        if (typeof id === 'string' && id) referencedUserIds.add(id);
      }
    }
  }

  const maps = {
    users: new Map(),
    departments: new Map(),
    conversations: new Map(),
    messages: new Map(),
    approvalRequests: new Map(),
    financeRequests: new Map(),
    leaveRequests: new Map(),
    documents: new Map(),
    tasks: new Map(),
    requisitions: new Map(),
    vendorDocuments: new Map(),
    customerOnboardings: new Map(),
    trainings: new Map()
  };

  const userIds = new Set([...(idsByType.get('User') || []), ...referencedUserIds]);
  if (userIds.size) {
    const users = await prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: {
        id: true,
        fullName: true,
        role: { select: { displayName: true } }
      }
    });
    for (const user of users) maps.users.set(user.id, user);
  }

  const departmentIds = idsByType.get('Department');
  if (departmentIds?.size) {
    const departments = await prisma.department.findMany({
      where: { id: { in: [...departmentIds] } },
      select: { id: true, name: true }
    });
    for (const department of departments) maps.departments.set(department.id, department);
  }

  const threadIds = idsByType.get('MailThread');
  if (threadIds?.size) {
    const threads = await prisma.conversation.findMany({
      where: { id: { in: [...threadIds] } },
      select: { id: true, subject: true }
    });
    for (const thread of threads) maps.conversations.set(thread.id, thread);
  }

  const messageIds = idsByType.get('MailMessage');
  if (messageIds?.size) {
    const messages = await prisma.message.findMany({
      where: { id: { in: [...messageIds] } },
      select: {
        id: true,
        conversation: { select: { subject: true } }
      }
    });
    for (const message of messages) maps.messages.set(message.id, message);
  }

  const approvalIds = idsByType.get('ApprovalRequest');
  if (approvalIds?.size) {
    const approvals = await prisma.approvalRequest.findMany({
      where: { id: { in: [...approvalIds] } },
      select: {
        id: true,
        requestType: true,
        entityType: true,
        entityId: true,
        status: true,
        requestedBy: { select: { id: true, fullName: true } }
      }
    });
    for (const approval of approvals) maps.approvalRequests.set(approval.id, approval);
  }

  const financeIds = idsByType.get('FinanceRequest');
  if (financeIds?.size) {
    const financeRequests = await prisma.financeRequest.findMany({
      where: { id: { in: [...financeIds] } },
      select: {
        id: true,
        type: true,
        title: true,
        status: true,
        amount: true,
        currency: true,
        requestedBy: { select: { id: true, fullName: true } }
      }
    });
    for (const request of financeRequests) maps.financeRequests.set(request.id, request);
  }

  const leaveIds = idsByType.get('LeaveRequest');
  if (leaveIds?.size) {
    const leaveRequests = await prisma.leaveRequest.findMany({
      where: { id: { in: [...leaveIds] } },
      select: {
        id: true,
        leaveType: true,
        startDate: true,
        endDate: true,
        days: true,
        status: true,
        employee: { select: { id: true, fullName: true } }
      }
    });
    for (const request of leaveRequests) maps.leaveRequests.set(request.id, request);
  }

  const documentIds = idsByType.get('Document');
  if (documentIds?.size) {
    const documents = await prisma.document.findMany({
      where: { id: { in: [...documentIds] } },
      select: { id: true, title: true, fileName: true, status: true }
    });
    for (const document of documents) maps.documents.set(document.id, document);
  }

  const taskIds = idsByType.get('Task');
  if (taskIds?.size) {
    const tasks = await prisma.task.findMany({
      where: { id: { in: [...taskIds] } },
      select: { id: true, title: true, status: true }
    });
    for (const task of tasks) maps.tasks.set(task.id, task);
  }

  const requisitionIds = idsByType.get('Requisition');
  if (requisitionIds?.size) {
    const requisitions = await prisma.requisition.findMany({
      where: { id: { in: [...requisitionIds] } },
      select: { id: true, title: true, status: true }
    });
    for (const req of requisitions) maps.requisitions.set(req.id, req);
  }

  const vendorDocIds = idsByType.get('VendorDocument');
  if (vendorDocIds?.size) {
    const vendorDocs = await prisma.vendorDocument.findMany({
      where: { id: { in: [...vendorDocIds] } },
      select: { id: true, vendorName: true, documentType: true, expiryDate: true }
    });
    for (const doc of vendorDocs) maps.vendorDocuments.set(doc.id, doc);
  }

  const onboardingIds = idsByType.get('CustomerOnboarding');
  if (onboardingIds?.size) {
    const onboardings = await prisma.customerOnboarding.findMany({
      where: { id: { in: [...onboardingIds] } },
      select: { id: true, businessName: true, status: true }
    });
    for (const onboarding of onboardings) maps.customerOnboardings.set(onboarding.id, onboarding);
  }

  const trainingIds = idsByType.get('Training');
  if (trainingIds?.size) {
    const trainings = await prisma.training.findMany({
      where: { id: { in: [...trainingIds] } },
      select: { id: true, title: true, trainingType: true }
    });
    for (const training of trainings) maps.trainings.set(training.id, training);
  }

  return maps;
}

function resolveEntityName(entry, maps) {
  if (!entry?.entityType) return null;

  const entityId = entry.entityId;
  const type = entry.entityType;

  if (!entityId) return type;

  if (type === 'User') return maps.users.get(entityId)?.fullName || String(entry?.newValues?.fullName || '').trim() || 'User';
  if (type === 'Department') return maps.departments.get(entityId)?.name || 'Department';
  if (type === 'MailThread') return maps.conversations.get(entityId)?.subject || String(entry?.newValues?.subject || '').trim() || 'Email thread';
  if (type === 'MailMessage') return maps.messages.get(entityId)?.conversation?.subject || String(entry?.newValues?.subject || '').trim() || 'Email';
  if (type === 'Task') return maps.tasks.get(entityId)?.title || 'Task';
  if (type === 'Document') return maps.documents.get(entityId)?.title || maps.documents.get(entityId)?.fileName || 'Document';
  if (type === 'FinanceRequest') return maps.financeRequests.get(entityId)?.title || 'Finance request';
  if (type === 'LeaveRequest') {
    const leave = maps.leaveRequests.get(entityId);
    if (!leave) return 'Leave request';
    return `Leave request by ${leave.employee?.fullName || 'Staff member'}`;
  }
  if (type === 'ApprovalRequest') {
    const approval = maps.approvalRequests.get(entityId);
    if (!approval) return 'Approval request';
    return `${approval.requestType} request by ${approval.requestedBy?.fullName || 'Staff member'}`;
  }
  if (type === 'Requisition') return maps.requisitions.get(entityId)?.title || 'Requisition';
  if (type === 'VendorDocument') {
    const doc = maps.vendorDocuments.get(entityId);
    if (!doc) return 'Vendor document';
    return `${doc.vendorName} ${doc.documentType}`.trim();
  }
  if (type === 'CustomerOnboarding') return maps.customerOnboardings.get(entityId)?.businessName || 'Customer onboarding';
  if (type === 'Training') return maps.trainings.get(entityId)?.title || 'Training';

  return type;
}

function resolveEmailRecipients(entry, maps) {
  const toUserIds = entry?.newValues?.toUserIds;
  if (!Array.isArray(toUserIds) || toUserIds.length === 0) return null;
  const names = toUserIds
    .map((id) => maps.users.get(id)?.fullName)
    .filter(Boolean);
  if (names.length === 0) return null;
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} +${names.length - 3} more`;
}

function resolveDetails(entry, context) {
  const { ua, maps, entityName } = context;
  const recipients = resolveEmailRecipients(entry, maps);
  const subject = String(entry?.newValues?.subject || '').trim() || (entry.entityType === 'MailThread' ? entityName : null);

  const auditKind = extractAuditKind(entry);

  if (entry.action === AUDIT_ACTIONS.USER_LOGIN) {
    return [ua.browser, ua.os, ua.device].filter(Boolean).join(' • ') || 'Login';
  }

  if (entry.action === AUDIT_ACTIONS.USER_FAILED_LOGIN) {
    const email = String(entry?.newValues?.email || '').trim();
    return email ? `Email: ${email}` : 'Invalid credentials';
  }

  if (auditKind && auditKind.startsWith('PASSWORD_')) return 'Account security';

  if (entry.action === AUDIT_ACTIONS.MESSAGE_SENT) {
    const pieces = [];
    if (recipients) pieces.push(`To: ${recipients}`);
    if (subject) pieces.push(`Subject: ${subject}`);
    if (entry?.newValues?.hasAttachments) pieces.push('Attachments: Yes');
    return pieces.join(' | ') || 'Email';
  }

  if (entry.action === AUDIT_ACTIONS.MESSAGE_EMAIL_DELIVERED || entry.action === AUDIT_ACTIONS.MESSAGE_EMAIL_FAILED) {
    return subject ? `Subject: ${subject}` : 'Email delivery';
  }

  if (entry.action === AUDIT_ACTIONS.APPROVAL_APPROVED || entry.action === AUDIT_ACTIONS.APPROVAL_REJECTED) {
    return entityName || 'Approval request';
  }

  if (entry.action === AUDIT_ACTIONS.ROLE_CHANGED) {
    const role = String(entry?.newValues?.role || '').trim();
    return role ? `Role: ${role}` : 'Role change';
  }

  if (entry.action === AUDIT_ACTIONS.DEPARTMENT_CHANGED) {
    const department = String(entry?.newValues?.department || '').trim();
    return department ? `Department: ${department}` : 'Department change';
  }

  if (
    entry.action === AUDIT_ACTIONS.LEAVE_REQUESTED
    || entry.action === AUDIT_ACTIONS.LEAVE_APPROVED
    || entry.action === AUDIT_ACTIONS.LEAVE_UPDATED
    || entry.action === AUDIT_ACTIONS.LEAVE_CREATED_FOR_STAFF
  ) {
    const leave = entry.entityId ? maps.leaveRequests.get(entry.entityId) : null;
    if (!leave) return 'Leave request';
    const days = leave.days != null ? `${Number(leave.days)} day${Number(leave.days) === 1 ? '' : 's'}` : null;
    return [titleCaseFromConstant(leave.leaveType), days].filter(Boolean).join(' • ');
  }

  if (entry.action === AUDIT_ACTIONS.FINANCE_REQUEST_CREATED || entry.action === AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED || entry.action === AUDIT_ACTIONS.FINANCE_REQUEST_PAID) {
    const req = entry.entityId ? maps.financeRequests.get(entry.entityId) : null;
    if (!req) return 'Finance request';
    return [req.title, titleCaseFromConstant(req.status)].filter(Boolean).join(' • ');
  }

  return entityName || titleCaseFromConstant(entry.entityType);
}

function resolveSummary(entry, context) {
  const { actorName, ua, entityName, details, maps } = context;
  const auditKind = extractAuditKind(entry);

  if (auditKind === 'PASSWORD_CHANGED') return `${actorName} changed their password.`;
  if (auditKind === 'PASSWORD_RESET_REQUESTED') return `${actorName} requested a password reset.`;
  if (auditKind === 'PASSWORD_RESET_COMPLETED') return `${actorName} reset their password.`;
  if (auditKind === 'PASSWORD_SETUP_COMPLETED') return `${actorName} set up their password.`;

  if (entry.action === AUDIT_ACTIONS.USER_LOGIN) {
    const browser = ua.browser;
    const os = ua.os;
    const device = ua.device;
    const deviceSuffix = device ? ` (${device})` : '';
    const via = browser || os ? ` using ${[browser, os].filter(Boolean).join(' on ')}${deviceSuffix}` : '';
    return `${actorName} logged in${via}.`;
  }

  if (entry.action === AUDIT_ACTIONS.USER_FAILED_LOGIN) {
    const email = String(entry?.newValues?.email || '').trim();
    const ip = entry.ipAddress ? ` from ${entry.ipAddress}` : '';
    return email ? `Failed login attempt for ${email}${ip}.` : `Failed login attempt${ip}.`;
  }

  if (entry.action === AUDIT_ACTIONS.USER_LOGOUT) return `${actorName} logged out.`;

  if (entry.action === AUDIT_ACTIONS.MESSAGE_SENT) {
    const recipients = resolveEmailRecipients(entry, maps) || 'recipients';
    const subject = String(entry?.newValues?.subject || '').trim() || entityName || 'an email';
    const attachments = entry?.newValues?.hasAttachments ? ' (with attachments)' : '';
    return `${actorName} sent an email${attachments} to ${recipients} with subject '${subject}'.`;
  }

  if (entry.action === AUDIT_ACTIONS.MESSAGE_EMAIL_DELIVERED) return `${actorName} sent an email successfully.`;
  if (entry.action === AUDIT_ACTIONS.MESSAGE_EMAIL_FAILED) return `${actorName} attempted to send an email but delivery failed.`;

  if (entry.action === AUDIT_ACTIONS.APPROVAL_APPROVED) return `${actorName} approved ${entityName || 'an approval request'}.`;
  if (entry.action === AUDIT_ACTIONS.APPROVAL_REJECTED) return `${actorName} rejected ${entityName || 'an approval request'}.`;

  if (entry.action === AUDIT_ACTIONS.USER_CREATED) return `${actorName} created staff member ${entityName || 'a staff member'}.`;

  if (entry.action === AUDIT_ACTIONS.ROLE_CHANGED) {
    const role = String(entry?.newValues?.role || '').trim();
    return role
      ? `${actorName} changed ${entityName || 'a user'}'s role to ${role}.`
      : `${actorName} changed ${entityName || 'a user'}'s role.`;
  }

  if (entry.action === AUDIT_ACTIONS.DEPARTMENT_CHANGED) {
    const department = String(entry?.newValues?.department || '').trim();
    return department
      ? `${actorName} changed ${entityName || 'a user'}'s department to ${department}.`
      : `${actorName} changed ${entityName || 'a user'}'s department.`;
  }

  if (entry.action === AUDIT_ACTIONS.DOCUMENT_UPLOADED) return `${actorName} uploaded ${entityName || 'a document'}.`;
  if (entry.action === AUDIT_ACTIONS.DOCUMENT_APPROVED) return `${actorName} approved ${entityName || 'a document'}.`;
  if (entry.action === AUDIT_ACTIONS.DOCUMENT_REJECTED) return `${actorName} rejected ${entityName || 'a document'}.`;

  if (entry.action === AUDIT_ACTIONS.TASK_CREATED) return `${actorName} created task '${entityName || 'a task'}'.`;
  if (entry.action === AUDIT_ACTIONS.TASK_UPDATED) return `${actorName} updated task '${entityName || 'a task'}'.`;

  if (entry.action === AUDIT_ACTIONS.FINANCE_REQUEST_CREATED) return `${actorName} created finance request '${entityName || 'a request'}'.`;
  if (entry.action === AUDIT_ACTIONS.FINANCE_REQUEST_PAID) return `${actorName} marked finance request '${entityName || 'a request'}' as paid.`;
  if (entry.action === AUDIT_ACTIONS.FINANCE_REQUEST_UPDATED) return `${actorName} updated finance request '${entityName || 'a request'}'.`;

  if (entry.action === AUDIT_ACTIONS.LEAVE_REQUESTED) return `${actorName} submitted ${entityName || 'a leave request'}.`;
  if (entry.action === AUDIT_ACTIONS.LEAVE_APPROVED) return `${actorName} approved ${entityName || 'a leave request'}.`;
  if (entry.action === AUDIT_ACTIONS.LEAVE_UPDATED) return `${actorName} updated ${entityName || 'a leave request'}.`;
  if (entry.action === AUDIT_ACTIONS.LEAVE_CREATED_FOR_STAFF) return `${actorName} created leave for a staff member.`;

  if (entry.action === AUDIT_ACTIONS.SETTINGS_UPDATED) return `${actorName} updated system settings.`;

  // Generic fallback that stays business-friendly.
  return `${actorName} performed "${resolveActionLabel(entry)}" on ${details || entityName || 'an item'}.`;
}

async function presentAuditLogs(items, prisma) {
  const maps = await buildEntityMaps(items, prisma);

  return items.map((item) => {
    const actorName = item?.actor?.fullName || 'System';
    const actorRole = item?.actor?.role?.displayName || null;
    const actionLabel = resolveActionLabel(item);
    const auditKind = extractAuditKind(item);
    const category = resolveCategory(item.action, auditKind);
    const ua = parseUserAgent(item.userAgent);
    const entityName = resolveEntityName(item, maps);
    const details = resolveDetails(item, { ua, maps, entityName });
    const summary = resolveSummary(item, { actorName, ua, entityName, details, maps });

    // Keep actor shape stable for existing clients.
    const actor = item.actor
      ? { id: item.actor.id, fullName: item.actor.fullName, email: item.actor.email }
      : null;

    return {
      ...item,
      actor,
      actorName,
      actorRole,
      actionLabel,
      entityName,
      summary,
      details,
      category,
      browser: ua.browser,
      os: ua.os,
      device: ua.device
    };
  });
}

module.exports = { presentAuditLogs, AUDIT_CATEGORIES, CATEGORY_ACTIONS };
