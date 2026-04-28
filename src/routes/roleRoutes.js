const crudRouteFactory = require('./crudRouteFactory');
const { services } = require('../services/moduleRegistry');
module.exports = crudRouteFactory(services.roles, 'Role', { read: 'roles:manage', write: 'roles:manage' });
