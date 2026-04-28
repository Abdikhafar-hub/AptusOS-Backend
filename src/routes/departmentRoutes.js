const express = require('express');
const controller = require('../controllers/departmentController');
const validate = require('../middleware/validate');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/guards');
const { idParam, userIdParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/domainValidators');

const router = express.Router();
router.use(authenticate);

router.get('/', requirePermission('departments:read'), validate(listQuery), controller.list);
router.post('/', requirePermission('departments:manage'), validate(v.departmentCreate), controller.create);
router.get('/:id', requirePermission('departments:read'), validate(idParam), controller.get);
router.patch('/:id', requirePermission('departments:manage'), validate(idParam), validate(v.departmentUpdate), controller.update);
router.delete('/:id', requirePermission('departments:manage'), validate(idParam), controller.archive);
router.post('/:id/staff', requirePermission('departments:manage'), validate(idParam), validate(v.addStaff), controller.addStaff);
router.post('/:id/transfer-staff', requirePermission('departments:manage'), validate(idParam), validate(v.transferStaff), controller.transferStaff);
router.delete('/:id/staff/:userId', requirePermission('departments:manage'), validate(userIdParam), controller.removeStaff);
router.get('/:id/dashboard', requirePermission('departments:read'), validate(idParam), controller.dashboard);

module.exports = router;
