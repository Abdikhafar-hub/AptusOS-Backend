const env = require('../config/env');
const logger = require('../config/logger');
const { error } = require('../utils/responses');

const normalizeJwtError = (err) => {
  if (!err || !err.name) return null;

  if (err.name === 'TokenExpiredError') {
    return {
      statusCode: 401,
      message: 'Access token expired'
    };
  }

  if (err.name === 'JsonWebTokenError' || err.name === 'NotBeforeError') {
    return {
      statusCode: 401,
      message: 'Invalid access token'
    };
  }

  return null;
};

const normalizePrismaError = (err) => {
  if (!err) return null;

  if (err.name === 'PrismaClientValidationError') {
    const message = String(err.message || '');
    const enumMatch = message.match(/argument `([^`]+)`\.\s*Expected\s+([A-Za-z0-9_]+)/i);

    if (enumMatch) {
      const [, field] = enumMatch;
      return {
        statusCode: 422,
        message: `Invalid value for "${field}". Please choose a valid option.`
      };
    }

    return {
      statusCode: 422,
      message: 'Invalid request data. Please review the form values and try again.'
    };
  }

  if (!err.code) return null;

  if (err.code === 'P2002') {
    const targets = Array.isArray(err.meta?.target) ? err.meta.target : [];
    const hasEmailTarget = targets.some((target) => String(target).toLowerCase().includes('email'));

    return {
      statusCode: 409,
      message: hasEmailTarget
        ? 'Email is already in use by another account'
        : 'This record conflicts with an existing one'
    };
  }

  if (err.code === 'P2003') {
    return {
      statusCode: 422,
      message: 'One of the linked records was not found'
    };
  }

  if (err.code === 'P2025') {
    return {
      statusCode: 404,
      message: 'Requested record was not found'
    };
  }

  return null;
};

const errorHandler = (err, req, res, next) => {
  const jwtError = normalizeJwtError(err);
  const prismaError = normalizePrismaError(err);
  const statusCode = jwtError?.statusCode || prismaError?.statusCode || err.statusCode || 500;
  const message = jwtError?.message || prismaError?.message || err.message || 'Internal server error';
  const payloadErrors = Array.isArray(err.errors) ? err.errors : [];

  if (statusCode >= 500) logger.error({ err, path: req.originalUrl }, err.message);

  if (env.nodeEnv !== 'production' && err.stack) {
    payloadErrors.push({ stack: err.stack });
  }

  return error(res, message, payloadErrors, statusCode);
};

module.exports = errorHandler;
