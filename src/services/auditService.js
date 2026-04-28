const prisma = require('../prisma/client');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

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
          newValues: resolvedNewValues,
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
