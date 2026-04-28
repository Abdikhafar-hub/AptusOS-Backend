const express = require('express');
const controller = require('../controllers/settingsController');
const validate = require('../middleware/validate');
const v = require('../validators/settingsValidators');

const router = express.Router();

router.get('/', controller.list);
router.get('/roles/:role', validate(v.roleParam), controller.getRoleSettings);
router.patch('/roles/:role', validate(v.roleParam), validate(v.updateRoleSettingsBody), controller.updateRoleSettings);
router.get('/:section', validate(v.sectionParam), controller.getSection);
router.patch('/:section', validate(v.sectionParam), validate(v.updateSectionBody), controller.updateSection);

module.exports = router;
