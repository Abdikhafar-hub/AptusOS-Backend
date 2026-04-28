const { Readable } = require('stream');
const cloudinary = require('../config/cloudinary');
const AppError = require('../utils/AppError');
const env = require('../config/env');

const folderFor = (folder = 'documents') => `aptus-os/${folder}`;

const uploadBuffer = (file, folder) => new Promise((resolve, reject) => {
  if (!file?.buffer) return reject(new AppError('No file buffer provided', 400));

  const stream = cloudinary.uploader.upload_stream(
    { folder: folderFor(folder), resource_type: 'auto', use_filename: true },
    (error, result) => (error ? reject(error) : resolve(result))
  );

  Readable.from(file.buffer).pipe(stream);
});

const uploadService = {
  async uploadSingleFile(file, folder) {
    if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
      throw new AppError(
        'File uploads are not configured. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in Backend/.env.',
        503
      );
    }

    try {
      const result = await uploadBuffer(file, folder);
      return {
        fileUrl: result.secure_url,
        cloudinaryPublicId: result.public_id,
        fileName: file.originalname,
        mimeType: file.mimetype,
        fileSize: file.size
      };
    } catch (error) {
      if (error instanceof AppError) throw error;

      const providerMessage = String(error?.message || '').toLowerCase();
      const providerStatus = Number(error?.http_code || 0);

      if (
        providerStatus === 401 ||
        providerStatus === 403 ||
        providerMessage.includes('cloud_name is disabled') ||
        providerMessage.includes('invalid api key') ||
        providerMessage.includes('must supply api_key')
      ) {
        throw new AppError(
          'File upload provider rejected credentials or cloud configuration. Check your Cloudinary account status and Backend/.env CLOUDINARY values.',
          503
        );
      }

      throw new AppError('File upload failed. Please try again.', 502);
    }
  },

  async uploadMultipleFiles(files = [], folder) {
    return Promise.all(files.map((file) => this.uploadSingleFile(file, folder)));
  },

  async deleteFile(publicId) {
    if (!publicId) return null;
    return cloudinary.uploader.destroy(publicId, { resource_type: 'auto' });
  },

  async getFileMetadata(publicId) {
    return cloudinary.api.resource(publicId, { resource_type: 'auto' });
  }
};

module.exports = uploadService;
