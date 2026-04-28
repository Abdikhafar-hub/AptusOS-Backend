const multer = require('multer');
const AppError = require('../utils/AppError');

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype) return cb(new AppError('Invalid file upload', 400));
    return cb(null, true);
  }
});

module.exports = {
  uploadSingle: (fieldName = 'file') => upload.single(fieldName),
  uploadMultiple: (fieldName = 'files', maxCount = 10) => upload.array(fieldName, maxCount)
};
