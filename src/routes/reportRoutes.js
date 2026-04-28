const express = require('express');
const controller = require('../controllers/reportController');
const { authenticate } = require('../middleware/auth');
const { requirePermission } = require('../middleware/guards');
const validate = require('../middleware/validate');
const v = require('../validators/reportValidators');

const router = express.Router();
router.use(authenticate, requirePermission('reports:read'));
router.get('/', validate(v.reportQuery), controller.runQuery);
router.get('/:type', controller.run);

module.exports = router;
