const { z, ZodError } = require('zod');
const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const { ROLES, normalizeRoleName } = require('../constants/roles');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const auditService = require('./auditService');
const { ALL_ROLES, SETTING_SCOPE_TYPES, SETTINGS_SECTION_DEFINITIONS } = require('../config/settingsCatalog');

const DEFAULT_ORGANIZATION_ID = process.env.DEFAULT_ORGANIZATION_ID || 'aptus-default-org';
const GLOBAL_SCOPE_KEY = 'GLOBAL';
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const SECTION_KEYS = Object.keys(SETTINGS_SECTION_DEFINITIONS);

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getViewerRole = (auth) => normalizeRoleName(auth?.roleName);

const isRoleSupported = (roleName) => ALL_ROLES.includes(normalizeRoleName(roleName));

const assertSupportedRole = (roleName) => {
  const normalized = normalizeRoleName(roleName);
  if (!isRoleSupported(normalized)) throw new AppError('Unsupported role', 400);
  return normalized;
};

const getDefinition = (section) => {
  const definition = SETTINGS_SECTION_DEFINITIONS[section];
  if (!definition) throw new AppError('Settings section not found', 404);
  return definition;
};

const canReadSection = (roleName, definition) => definition.visibleTo.includes(normalizeRoleName(roleName));

const canEditSection = (roleName, definition) => definition.editableBy.includes(normalizeRoleName(roleName));

const resolveScopeKey = (definition, auth, options = {}) => {
  if (definition.scopeType === SETTING_SCOPE_TYPES.ORGANIZATION) return GLOBAL_SCOPE_KEY;
  if (definition.scopeType === SETTING_SCOPE_TYPES.ROLE) return options.targetRole || getViewerRole(auth) || GLOBAL_SCOPE_KEY;
  if (definition.scopeType === SETTING_SCOPE_TYPES.USER) return options.userId || auth?.userId || GLOBAL_SCOPE_KEY;
  if (definition.scopeType === SETTING_SCOPE_TYPES.DEPARTMENT) {
    return options.departmentId || auth?.departmentIds?.[0] || GLOBAL_SCOPE_KEY;
  }
  return GLOBAL_SCOPE_KEY;
};

const buildFieldSchema = (field) => {
  if (field.type === 'boolean') return z.boolean();
  if (field.type === 'number') {
    let schema = z.number().finite();
    if (typeof field.min === 'number') schema = schema.min(field.min);
    if (typeof field.max === 'number') schema = schema.max(field.max);
    return schema;
  }
  if (field.type === 'select') {
    const options = Array.isArray(field.options) ? field.options.map((option) => String(option.value)) : [];
    if (!options.length) return z.string().trim();
    return z.enum(options);
  }
  if (field.type === 'email') return z.string().trim().email();
  if (field.type === 'url') {
    return z.string().trim().refine((value) => value.startsWith('/') || /^https?:\/\//.test(value), 'Invalid URL');
  }
  if (field.type === 'color') return z.string().trim().regex(HEX_COLOR_REGEX, 'Invalid color value');

  return z.string().trim().min(1).max(2000);
};

const buildSectionSchema = (definition) => {
  const shape = Object.fromEntries(definition.fields.map((field) => [field.key, buildFieldSchema(field)]));
  return z.object(shape).strict();
};

const parseSectionValues = (definition, values) => {
  const schema = buildSectionSchema(definition);
  try {
    return schema.parse(values);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new AppError('Validation failed', 422, error.errors);
    }
    throw error;
  }
};

const getStoredEntries = async ({ organizationId, section, scopeType, scopeKey }) => prisma.setting.findMany({
  where: {
    organizationId,
    section,
    scopeType,
    scopeKey
  },
  orderBy: { updatedAt: 'desc' }
});

const buildValuesFromEntries = (definition, entries) => {
  const allowedKeys = new Set(definition.fields.map((field) => field.key));
  const stored = Object.fromEntries(
    entries
      .filter((entry) => allowedKeys.has(entry.key))
      .map((entry) => [entry.key, entry.value])
  );
  return { ...definition.defaults, ...stored };
};

const toSectionResponse = ({
  definition,
  organizationId,
  scopeKey,
  values,
  canEdit,
  updatedAt
}) => ({
  key: definition.key,
  title: definition.title,
  description: definition.description,
  organizationId,
  scopeType: definition.scopeType,
  scopeKey,
  canEdit,
  fields: definition.fields,
  values,
  updatedAt
});

const saveSectionValues = async ({
  definition,
  organizationId,
  scopeKey,
  values,
  actorId
}) => Promise.all(
  Object.entries(values).map(([key, value]) => prisma.setting.upsert({
    where: {
      organizationId_section_key_scopeType_scopeKey: {
        organizationId,
        section: definition.key,
        key,
        scopeType: definition.scopeType,
        scopeKey
      }
    },
    create: {
      organizationId,
      section: definition.key,
      key,
      scopeType: definition.scopeType,
      scopeKey,
      value,
      createdById: actorId,
      updatedById: actorId
    },
    update: {
      value,
      updatedById: actorId
    }
  }))
);

const getOrganizationId = () => DEFAULT_ORGANIZATION_ID;

const getSectionForContext = async ({
  definition,
  auth,
  organizationId,
  viewerRole,
  canEdit,
  targetRole
}) => {
  const scopeKey = resolveScopeKey(definition, auth, { targetRole });
  const entries = await getStoredEntries({
    organizationId,
    section: definition.key,
    scopeType: definition.scopeType,
    scopeKey
  });
  const values = parseSectionValues(definition, buildValuesFromEntries(definition, entries));
  return toSectionResponse({
    definition,
    organizationId,
    scopeKey,
    canEdit,
    values,
    updatedAt: entries[0]?.updatedAt || null,
    viewerRole
  });
};

const assertSettingsAccess = (definition, roleName) => {
  if (!canReadSection(roleName, definition)) throw new AppError('You do not have access to this settings section', 403);
};

const settingsService = {
  async getOverview(auth) {
    const viewerRole = assertSupportedRole(getViewerRole(auth));
    const organizationId = getOrganizationId();
    const definitions = SECTION_KEYS
      .map((key) => SETTINGS_SECTION_DEFINITIONS[key])
      .filter((definition) => canReadSection(viewerRole, definition));

    const sections = await Promise.all(definitions.map((definition) => getSectionForContext({
      definition,
      auth,
      organizationId,
      viewerRole,
      canEdit: canEditSection(viewerRole, definition)
    })));

    return {
      organizationId,
      viewerRole,
      manageableRoles: viewerRole === ROLES.GENERAL_MANAGER ? ALL_ROLES : [viewerRole],
      sections
    };
  },

  async getSection(auth, section) {
    const viewerRole = assertSupportedRole(getViewerRole(auth));
    const definition = getDefinition(section);
    assertSettingsAccess(definition, viewerRole);

    return getSectionForContext({
      definition,
      auth,
      organizationId: getOrganizationId(),
      viewerRole,
      canEdit: canEditSection(viewerRole, definition)
    });
  },

  async updateSection(auth, section, payload, req) {
    const viewerRole = assertSupportedRole(getViewerRole(auth));
    const definition = getDefinition(section);
    assertSettingsAccess(definition, viewerRole);
    if (!canEditSection(viewerRole, definition)) throw new AppError('You do not have edit access to this settings section', 403);

    const organizationId = getOrganizationId();
    const scopeKey = resolveScopeKey(definition, auth);
    const existingEntries = await getStoredEntries({
      organizationId,
      section: definition.key,
      scopeType: definition.scopeType,
      scopeKey
    });

    const previousValues = parseSectionValues(definition, buildValuesFromEntries(definition, existingEntries));
    const incomingValues = isPlainObject(payload?.values) ? payload.values : payload;
    if (!isPlainObject(incomingValues)) throw new AppError('Invalid settings payload', 422);
    const mergedValues = parseSectionValues(definition, { ...previousValues, ...incomingValues });

    await saveSectionValues({
      definition,
      organizationId,
      scopeKey,
      values: mergedValues,
      actorId: auth.userId
    });

    await auditService.log({
      actorId: auth.userId,
      action: AUDIT_ACTIONS.SETTINGS_UPDATED,
      entityType: 'Setting',
      entityId: `${definition.key}:${definition.scopeType}:${scopeKey}`,
      oldValues: previousValues,
      newValues: mergedValues,
      req
    });

    return getSectionForContext({
      definition,
      auth,
      organizationId,
      viewerRole,
      canEdit: true
    });
  },

  async getRoleSettings(auth, roleName) {
    const viewerRole = assertSupportedRole(getViewerRole(auth));
    const targetRole = assertSupportedRole(roleName);
    if (viewerRole !== ROLES.GENERAL_MANAGER && viewerRole !== targetRole) {
      throw new AppError('You can only view settings for your own role', 403);
    }

    const organizationId = getOrganizationId();
    const definitions = SECTION_KEYS
      .map((key) => SETTINGS_SECTION_DEFINITIONS[key])
      .filter((definition) => definition.scopeType === SETTING_SCOPE_TYPES.ROLE && canReadSection(targetRole, definition));

    const sections = await Promise.all(definitions.map((definition) => getSectionForContext({
      definition,
      auth,
      organizationId,
      viewerRole,
      targetRole,
      canEdit: canEditSection(viewerRole, definition) && (viewerRole === ROLES.GENERAL_MANAGER || viewerRole === targetRole)
    })));

    return {
      organizationId,
      role: targetRole,
      sections
    };
  },

  async updateRoleSettings(auth, roleName, payload, req) {
    const viewerRole = assertSupportedRole(getViewerRole(auth));
    const targetRole = assertSupportedRole(roleName);
    if (viewerRole !== ROLES.GENERAL_MANAGER && viewerRole !== targetRole) {
      throw new AppError('You can only update settings for your own role', 403);
    }

    if (!isPlainObject(payload?.sections)) throw new AppError('Invalid role settings payload', 422);
    const sectionEntries = Object.entries(payload.sections);
    if (!sectionEntries.length) throw new AppError('No role settings updates provided', 422);

    const organizationId = getOrganizationId();
    for (const [section, incomingValues] of sectionEntries) {
      const definition = getDefinition(section);
      if (definition.scopeType !== SETTING_SCOPE_TYPES.ROLE) {
        throw new AppError(`Section ${section} is not role-scoped`, 422);
      }
      if (!canReadSection(targetRole, definition)) {
        throw new AppError(`Section ${section} is not available for role ${targetRole}`, 403);
      }
      const canEdit = canEditSection(viewerRole, definition) && (viewerRole === ROLES.GENERAL_MANAGER || viewerRole === targetRole);
      if (!canEdit) throw new AppError(`You do not have edit access to section ${section}`, 403);

      if (!isPlainObject(incomingValues)) throw new AppError(`Invalid settings values for section ${section}`, 422);

      const scopeKey = targetRole;
      const existingEntries = await getStoredEntries({
        organizationId,
        section: definition.key,
        scopeType: definition.scopeType,
        scopeKey
      });
      const previousValues = parseSectionValues(definition, buildValuesFromEntries(definition, existingEntries));
      const mergedValues = parseSectionValues(definition, { ...previousValues, ...incomingValues });

      await saveSectionValues({
        definition,
        organizationId,
        scopeKey,
        values: mergedValues,
        actorId: auth.userId
      });

      await auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.SETTINGS_UPDATED,
        entityType: 'Setting',
        entityId: `${definition.key}:${definition.scopeType}:${scopeKey}`,
        oldValues: previousValues,
        newValues: mergedValues,
        req
      });
    }

    return this.getRoleSettings(auth, targetRole);
  }
};

module.exports = settingsService;
