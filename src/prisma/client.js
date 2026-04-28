const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');

const openssl3Engine = path.resolve(__dirname, '../../node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node');
if (!process.env.PRISMA_QUERY_ENGINE_LIBRARY && fs.existsSync(openssl3Engine)) {
  process.env.PRISMA_QUERY_ENGINE_LIBRARY = openssl3Engine;
}

const prisma = new PrismaClient({
  log: [
    { emit: 'event', level: 'error' },
    { emit: 'event', level: 'warn' }
  ]
});

prisma.$on('error', (event) => logger.error(event));
prisma.$on('warn', (event) => logger.warn(event));

module.exports = prisma;
