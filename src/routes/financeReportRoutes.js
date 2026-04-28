const express = require('express');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const controller = require('../controllers/financeReportController');
const v = require('../validators/financeReportValidators');

const router = express.Router();

router.use(authenticate);

router.get('/summary', validate(v.reportQuery), controller.summary);
router.get('/saved-views', controller.listSavedViews);
router.post('/saved-views', validate(v.savedViewCreate), controller.saveView);
router.delete('/saved-views/:id', validate(v.savedViewIdParam), controller.deleteView);

router.get('/:reportType/export', validate(v.reportTypeParam), validate(v.reportQuery), controller.export);
router.get('/:reportType', validate(v.reportTypeParam), validate(v.reportQuery), controller.run);

module.exports = router;
