const express = require('express');
const prisma = require('../prisma/client');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

const router = express.Router();
router.get('/', asyncHandler(async (req, res) => {
  await prisma.$queryRaw`SELECT 1`;
  return success(res, 'AptusOS backend healthy', { uptime: process.uptime(), timestamp: new Date().toISOString() });
}));

module.exports = router;
