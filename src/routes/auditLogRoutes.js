const express = require('express');
const controller = require('../controllers/auditLogController');
const validate = require('../middleware/validate');
const { listQuery } = require('../validators/commonValidators');
const { requirePermission } = require('../middleware/guards');

const router = express.Router();

router.get('/', requirePermission('audit_logs:read'), validate(listQuery), controller.list);

module.exports = router;
