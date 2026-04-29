const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const accessControlService = require('./accessControlService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');

const GOVERNANCE_CATALOG = Object.freeze({
  discountApprovalThresholdPercent: {
    description: 'Discount approval threshold percentage requiring escalation.',
    defaultValue: 10,
    type: 'number',
    min: 0,
    max: 100
  },
  procurementApprovalThresholdAmount: {
    description: 'Procurement approval threshold amount for executive visibility.',
    defaultValue: 100000,
    type: 'number',
    min: 0
  },
  leaveRejectEscalationCount: {
    description: 'Number of repeated leave rejections before escalation.',
    defaultValue: 3,
    type: 'number',
    min: 1,
    max: 20
  },
  approvalSlaHours: {
    description: 'Approval SLA in hours.',
    defaultValue: 24,
    type: 'number',
    min: 1,
    max: 240
  },
  taskAcknowledgementSlaHours: {
    description: 'Task acknowledgement SLA in hours.',
    defaultValue: 12,
    type: 'number',
    min: 1,
    max: 240
  },
  issueResolutionSlaHours: {
    description: 'Issue resolution SLA in hours.',
    defaultValue: 48,
    type: 'number',
    min: 1,
    max: 720
  },
  paymentTermsExceptionDays: {
    description: 'Payment term exception threshold in days.',
    defaultValue: 45,
    type: 'number',
    min: 1,
    max: 365
  },
  creditRiskThreshold: {
    description: 'Credit risk threshold percentage for escalations.',
    defaultValue: 70,
    type: 'number',
    min: 1,
    max: 100
  },
  missingDocumentsEscalationDays: {
    description: 'Escalate missing critical documents older than this many days.',
    defaultValue: 7,
    type: 'number',
    min: 1,
    max: 60
  },
  licenseExpiryWarningDays: {
    description: 'Warn when license expiries fall within this many days.',
    defaultValue: 30,
    type: 'number',
    min: 1,
    max: 180
  }
});

function normalizeSettingValue(key, value) {
  const catalog = GOVERNANCE_CATALOG[key];
  if (!catalog) throw new AppError(`Unsupported governance setting key: ${key}`, 422);

  if (catalog.type === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new AppError(`${key} must be a valid number`, 422);
    if (catalog.min !== undefined && numeric < catalog.min) throw new AppError(`${key} must be at least ${catalog.min}`, 422);
    if (catalog.max !== undefined && numeric > catalog.max) throw new AppError(`${key} must be at most ${catalog.max}`, 422);
    return numeric;
  }

  return value;
}

async function readCompanySettingsMap(tx = prisma) {
  const rows = await tx.companySetting.findMany();
  return new Map(rows.map((row) => [row.key, row]));
}

const governanceService = {
  catalog: GOVERNANCE_CATALOG,

  async getSettings() {
    const settingsMap = await readCompanySettingsMap();

    return Object.entries(GOVERNANCE_CATALOG).map(([key, meta]) => {
      const persisted = settingsMap.get(key);
      return {
        key,
        description: persisted?.description || meta.description,
        value: persisted?.value ?? meta.defaultValue,
        defaultValue: meta.defaultValue,
        type: meta.type,
        min: meta.min,
        max: meta.max,
        updatedAt: persisted?.updatedAt || null
      };
    });
  },

  async getResolvedMap() {
    const settings = await this.getSettings();
    return settings.reduce((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});
  },

  async updateSettings(auth, payload = [], req) {
    if (!accessControlService.isGeneralManager(auth)) {
      throw new AppError('Only General Manager can update governance settings', 403);
    }

    if (!Array.isArray(payload) || payload.length < 1) {
      throw new AppError('At least one governance setting is required', 422);
    }

    const updates = payload.map((entry) => {
      if (!entry?.key) throw new AppError('Setting key is required', 422);
      const key = String(entry.key).trim();
      const normalized = normalizeSettingValue(key, entry.value);
      return {
        key,
        value: normalized,
        description: entry.description ? String(entry.description) : GOVERNANCE_CATALOG[key].description
      };
    });

    const persisted = await prisma.$transaction(async (tx) => {
      const rows = [];
      for (const item of updates) {
        const row = await tx.companySetting.upsert({
          where: { key: item.key },
          update: {
            value: item.value,
            description: item.description
          },
          create: {
            key: item.key,
            value: item.value,
            description: item.description
          }
        });
        rows.push(row);
      }

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.GOVERNANCE_SETTING_UPDATED,
        entityType: 'CompanySetting',
        entityId: null,
        newValues: rows,
        req
      }, tx);

      return rows;
    });

    return persisted;
  }
};

module.exports = governanceService;
