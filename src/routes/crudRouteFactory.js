const express = require('express');
const createController = require('../controllers/controllerFactory');
const validate = require('../middleware/validate');
const { listQuery, idParam, anyBody } = require('../validators/commonValidators');
const { requirePermission } = require('../middleware/guards');

const crudRouteFactory = (service, label, permissions = {}) => {
  const router = express.Router();
  const controller = createController(service, label);
  router.get('/', requirePermission(permissions.read || 'reports:read'), validate(listQuery), controller.list);
  router.post('/', requirePermission(permissions.write || permissions.read || 'settings:manage'), validate(anyBody), controller.create);
  router.get('/:id', requirePermission(permissions.read || 'reports:read'), validate(idParam), controller.get);
  router.patch('/:id', requirePermission(permissions.write || permissions.read || 'settings:manage'), validate(idParam), validate(anyBody), controller.update);
  router.delete('/:id', requirePermission(permissions.write || permissions.read || 'settings:manage'), validate(idParam), controller.archive);
  return router;
};

module.exports = crudRouteFactory;
