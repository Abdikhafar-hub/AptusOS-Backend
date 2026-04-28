const crudRouteFactory = require('./crudRouteFactory');
const { services } = require('../services/moduleRegistry');
module.exports = crudRouteFactory(services.permissions, 'Permission', { read: 'permissions:manage', write: 'permissions:manage' });
