const express = require('express');

const controller = require('../controllers/fileController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { fileIdParam } = require('../validators/commonValidators');

const router = express.Router();
router.use(authenticate);

router.get('/:fileId', validate(fileIdParam), controller.getAccess);
router.get('/:fileId/download', validate(fileIdParam), controller.download);

module.exports = router;
