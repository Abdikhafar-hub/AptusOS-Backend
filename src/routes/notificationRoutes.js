const express = require('express');
const controller = require('../controllers/notificationController');
const validate = require('../middleware/validate');
const { listQuery, idParam } = require('../validators/commonValidators');

const router = express.Router();

router.get('/', validate(listQuery), controller.list);
router.patch('/mark-all-read', controller.markAllRead);
router.post('/mark-all-read', controller.markAllRead);
router.patch('/:id/read', validate(idParam), controller.markRead);
router.post('/:id/read', validate(idParam), controller.markRead);

module.exports = router;
