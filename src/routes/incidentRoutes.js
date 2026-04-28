const express = require('express');
const controller = require('../controllers/complianceController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/complianceValidators');

const router = express.Router();

router.get('/', requirePermission('compliance:manage'), validate(listQuery), controller.listIncidents);
router.post('/', requirePermission('compliance:manage'), validate(v.incident), controller.createIncident);
router.get('/:id', requirePermission('compliance:manage'), validate(idParam), controller.getIncident);
router.post('/:id/status', requirePermission('compliance:manage'), validate(idParam), validate(v.incidentStatus), controller.updateIncidentStatus);

module.exports = router;
