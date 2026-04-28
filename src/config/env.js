const dotenv = require('dotenv');

dotenv.config();

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  databaseUrl: process.env.DATABASE_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET || 'development-access-secret',
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET || 'development-refresh-secret',
  jwtAccessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  bcryptSaltRounds: Number(process.env.BCRYPT_SALT_ROUNDS || 12),
  corsOrigin: process.env.CORS_ORIGIN || '*',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET
  },
  email: {
    defaultProvider: process.env.EMAIL_DEFAULT_PROVIDER || 'resend',
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT || 587),
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
    from: process.env.EMAIL_FROM || 'AptusOS <no-reply@aptuspharma.local>'
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY,
    domain: process.env.RESEND_DOMAIN,
    fromEmail: process.env.RESEND_FROM_EMAIL || 'AptusOS <no-reply@aptuspharma.local>',
    fromName: process.env.RESEND_FROM_NAME || process.env.NEXT_PUBLIC_APP_NAME || 'AptusOS',
    supportEmail: process.env.SUPPORT_EMAIL
  },
  appName: process.env.APP_NAME || process.env.RESEND_FROM_NAME || process.env.NEXT_PUBLIC_APP_NAME || 'AptusOS',
  frontendAppUrl: process.env.FRONTEND_APP_URL || 'http://localhost:3000',
  defaultGm: {
    email: process.env.DEFAULT_GM_EMAIL,
    password: process.env.DEFAULT_GM_PASSWORD,
    firstName: process.env.DEFAULT_GM_FIRST_NAME || 'General',
    lastName: process.env.DEFAULT_GM_LAST_NAME || 'Manager'
  },
  defaultOrganizationId: process.env.DEFAULT_ORGANIZATION_ID || 'aptus-default-org'
};

module.exports = env;
