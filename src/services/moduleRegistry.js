const createCrudService = require('./baseCrudService');

const moduleRegistry = {
  roles: { model: 'role', searchable: ['displayName', 'description'] },
  permissions: { model: 'permission', searchable: ['key', 'description'], softDelete: false },
  settings: { model: 'setting', searchable: ['key'], softDelete: false }
};

const services = Object.fromEntries(Object.entries(moduleRegistry).map(([key, config]) => [key, createCrudService(config)]));

module.exports = { moduleRegistry, services };
