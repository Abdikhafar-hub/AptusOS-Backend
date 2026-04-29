const prisma = require('../prisma/client');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

function humanizeAction(action) {
  const map = {
    [AUDIT_ACTIONS.APPROVAL_APPROVED]: 'approved a request',
    [AUDIT_ACTIONS.APPROVAL_REJECTED]: 'rejected a request',
    [AUDIT_ACTIONS.ESCALATION_CREATED]: 'raised an escalation',
    [AUDIT_ACTIONS.ESCALATION_RESOLVED]: 'resolved an escalation',
    [AUDIT_ACTIONS.CONTRACT_CREATED]: 'created a contract',
    [AUDIT_ACTIONS.CONTRACT_UPDATED]: 'updated a contract',
    [AUDIT_ACTIONS.CONTRACT_DELETED]: 'removed a contract',
    [AUDIT_ACTIONS.DELEGATION_CREATED]: 'created a delegation',
    [AUDIT_ACTIONS.DELEGATION_UPDATED]: 'updated a delegation',
    [AUDIT_ACTIONS.DELEGATION_REVOKED]: 'revoked a delegation',
    [AUDIT_ACTIONS.GOVERNANCE_SETTING_UPDATED]: 'updated governance settings',
    [AUDIT_ACTIONS.GM_REPORT_RUN]: 'ran an enterprise report'
  };

  if (map[action]) return map[action];
  return String(action || 'UPDATED')
    .replaceAll('_', ' ')
    .toLowerCase();
}

function buildFriendlyPayload(action, entityType, entityId, payload) {
  const base = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  return {
    ...base,
    auditFriendlyMessage: `${humanizeAction(action)} on ${entityType || 'entity'}${entityId ? ` (${entityId})` : ''}`.trim()
  };
}

const auditService = {
  async log({ actorId, action, entityType, entityId, oldValues, newValues, req }, tx = prisma) {
    const createAuditRecord = (resolvedAction, resolvedNewValues = newValues) =>
      tx.auditLog.create({
        data: {
          actorId,
          action: resolvedAction,
          entityType,
          entityId,
          oldValues,
          newValues: buildFriendlyPayload(resolvedAction, entityType, entityId, resolvedNewValues),
          ipAddress: req?.ip,
          userAgent: req?.headers?.['user-agent']
        }
      });

    try {
      return await createAuditRecord(action);
    } catch (error) {
      const invalidAuditAction = error?.name === 'PrismaClientValidationError' && String(error.message).includes('Expected AuditAction');
      if (!invalidAuditAction || action === AUDIT_ACTIONS.USER_UPDATED) {
        throw error;
      }

      // Keep the request successful even if the DB enum is behind code-level action constants.
      return createAuditRecord(
        AUDIT_ACTIONS.USER_UPDATED,
        {
          ...(newValues || {}),
          originalAuditAction: action
        }
      );
    }
  }
};

module.exports = auditService;
