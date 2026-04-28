const express = require('express');
const controller = require('../controllers/customerController');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/guards');
const { idParam, listQuery } = require('../validators/commonValidators');
const v = require('../validators/customerValidators');

const router = express.Router();

router.get('/', requirePermission('customers:manage'), validate(listQuery), controller.list);
router.post('/', requirePermission('customers:manage'), validate(v.create), controller.create);
router.get('/:id', requirePermission('customers:manage'), validate(idParam), controller.get);
router.patch('/:id', requirePermission('customers:manage'), validate(idParam), validate(v.update), controller.update);
router.post('/:id/review', requirePermission('customers:manage'), controller.review);

module.exports = router;
