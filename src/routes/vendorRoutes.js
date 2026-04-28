const express = require('express');
const controller = require('../controllers/operationsController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/operationsValidators');

const router = express.Router();

router.get('/', requirePermission('operations:manage'), validate(listQuery), controller.listVendorDocuments);
router.post('/', requirePermission('operations:manage'), validate(v.vendorDocument), controller.createVendorDocument);
router.get('/:id', requirePermission('operations:manage'), validate(idParam), controller.getVendorDocument);
router.delete('/:id', requirePermission('operations:manage'), validate(idParam), controller.archiveVendorDocument);

module.exports = router;
