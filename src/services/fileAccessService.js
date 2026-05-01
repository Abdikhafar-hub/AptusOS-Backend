const { Readable } = require('stream');

const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');
const accessControlService = require('./accessControlService');
const auditService = require('./auditService');
const { AUDIT_ACTIONS } = require('../constants/auditActions');
const cloudinary = require('../config/cloudinary');
const env = require('../config/env');

const DEFAULT_RESOURCE_TYPE = 'raw';
const DEFAULT_DELIVERY_TYPE = 'authenticated';
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 120;

const LOCATOR_FALLBACKS = [
  { resourceType: 'raw', deliveryType: 'authenticated' },
  { resourceType: 'raw', deliveryType: 'upload' },
  { resourceType: 'image', deliveryType: 'authenticated' },
  { resourceType: 'image', deliveryType: 'upload' },
  { resourceType: 'video', deliveryType: 'authenticated' },
  { resourceType: 'video', deliveryType: 'upload' }
];

function resolveTtlSeconds() {
  const configured = Number(env.cloudinary.signedUrlTtlSeconds || 90);
  if (!Number.isFinite(configured)) return 90;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.floor(configured)));
}

function extractFormat(fileName, mimeType) {
  const fromName = String(fileName || '').split('.').pop();
  if (fromName && fromName !== fileName) return fromName.toLowerCase();

  const mime = String(mimeType || '').toLowerCase();
  if (mime.includes('pdf')) return 'pdf';
  if (mime.includes('json')) return 'json';
  if (mime.includes('csv')) return 'csv';
  if (mime.includes('msword')) return 'doc';
  if (mime.includes('officedocument.wordprocessingml.document')) return 'docx';
  if (mime.includes('officedocument.spreadsheetml.sheet')) return 'xlsx';
  if (mime.includes('officedocument.presentationml.presentation')) return 'pptx';
  if (mime.includes('zip')) return 'zip';
  return null;
}

function parseStorageUri(value) {
  if (!value || typeof value !== 'string' || !value.startsWith('cloudinary://')) return null;
  const withoutScheme = value.slice('cloudinary://'.length);
  const [resourceType, deliveryType, ...publicIdParts] = withoutScheme.split('/');
  const publicId = publicIdParts.join('/').trim();
  if (!resourceType || !deliveryType || !publicId) return null;
  return { resourceType, deliveryType, publicId };
}

function buildLocatorCandidates(document) {
  const dedupe = new Set();
  const candidates = [];
  const inferredFormat = extractFormat(document.fileName, document.mimeType);

  const pushCandidate = (resourceType, deliveryType, publicId) => {
    const normalizedPublicId = String(publicId || '').trim();
    if (!resourceType || !deliveryType || !normalizedPublicId) return;
    const variants = [normalizedPublicId];

    // Raw assets often require extension in public_id. Older rows may have stored it without extension.
    if (resourceType === 'raw' && inferredFormat) {
      if (!normalizedPublicId.toLowerCase().endsWith(`.${inferredFormat.toLowerCase()}`)) {
        variants.push(`${normalizedPublicId}.${inferredFormat}`);
      }
      if (normalizedPublicId.toLowerCase().endsWith(`.${inferredFormat.toLowerCase()}`)) {
        variants.push(normalizedPublicId.slice(0, -(inferredFormat.length + 1)));
      }
    }

    variants.forEach((candidatePublicId) => {
      const key = `${resourceType}:${deliveryType}:${candidatePublicId}`;
      if (dedupe.has(key)) return;
      dedupe.add(key);
      candidates.push({ resourceType, deliveryType, publicId: candidatePublicId });
    });
  };

  const parsedFromStorageUri = parseStorageUri(document.fileUrl);
  if (parsedFromStorageUri) {
    pushCandidate(parsedFromStorageUri.resourceType, parsedFromStorageUri.deliveryType, parsedFromStorageUri.publicId);
  }

  pushCandidate(
    document.cloudinaryResourceType || DEFAULT_RESOURCE_TYPE,
    document.cloudinaryDeliveryType || DEFAULT_DELIVERY_TYPE,
    document.cloudinaryPublicId
  );

  LOCATOR_FALLBACKS.forEach((fallback) => {
    pushCandidate(fallback.resourceType, fallback.deliveryType, document.cloudinaryPublicId);
  });

  return candidates;
}

function isNotFoundError(error) {
  const nested = error?.error || {};
  const message = String(error?.message || nested?.message || '').toLowerCase();
  const status = Number(error?.http_code || error?.statusCode || nested?.http_code || 0);
  return status === 404 || message.includes('resource not found') || message.includes('not found');
}

async function resolveCloudinaryLocator(document) {
  const candidates = buildLocatorCandidates(document);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const metadata = await cloudinary.api.resource(candidate.publicId, {
        resource_type: candidate.resourceType,
        type: candidate.deliveryType
      });
      return {
        ...candidate,
        format: metadata?.format || extractFormat(document.fileName, document.mimeType)
      };
    } catch (error) {
      lastError = error;
      if (isNotFoundError(error)) continue;
      throw new AppError('Unable to validate file location in storage provider.', 502);
    }
  }

  if (lastError && isNotFoundError(lastError)) {
    throw new AppError('File was not found in storage provider.', 404);
  }
  throw new AppError('Unable to resolve file location in storage provider.', 502);
}

function ensureCloudinaryConfigured() {
  if (!env.cloudinary.cloudName || !env.cloudinary.apiKey || !env.cloudinary.apiSecret) {
    throw new AppError('Secure file access is not configured on this server.', 503);
  }
}

function buildSignedUrl(locator, expiresAtUnix) {
  if (!locator?.publicId) throw new AppError('This file is missing Cloudinary metadata.', 422);

  if (locator?.format) {
    return cloudinary.utils.private_download_url(locator.publicId, locator.format, {
      resource_type: locator.resourceType,
      type: locator.deliveryType,
      expires_at: expiresAtUnix,
      attachment: false
    });
  }

  return cloudinary.url(locator.publicId, {
    resource_type: locator.resourceType,
    type: locator.deliveryType,
    sign_url: true,
    secure: true,
    expires_at: expiresAtUnix
  });
}

async function persistResolvedLocator(documentId, locator) {
  if (!documentId || !locator?.publicId || !locator?.resourceType || !locator?.deliveryType) return;
  const storageUri = `cloudinary://${locator.resourceType}/${locator.deliveryType}/${locator.publicId}`;
  await prisma.document.update({
    where: { id: documentId },
    data: {
      cloudinaryPublicId: locator.publicId,
      cloudinaryResourceType: locator.resourceType,
      cloudinaryDeliveryType: locator.deliveryType,
      fileUrl: storageUri
    }
  });
}

const fileAccessService = {
  async resolveDocumentForAccess(fileId, auth) {
    const document = await prisma.document.findFirst({
      where: { id: fileId, deletedAt: null },
      select: {
        id: true,
        title: true,
        fileName: true,
        fileUrl: true,
        mimeType: true,
        fileSize: true,
        ownerType: true,
        ownerId: true,
        uploadedById: true,
        departmentId: true,
        visibility: true,
        cloudinaryPublicId: true,
        cloudinaryResourceType: true,
        cloudinaryDeliveryType: true
      }
    });

    if (!document) throw new AppError('File not found', 404);
    accessControlService.assertDocumentAccess(auth, document);
    return document;
  },

  async getSignedAccess(fileId, auth, req) {
    ensureCloudinaryConfigured();
    const document = await this.resolveDocumentForAccess(fileId, auth);
    const locator = await resolveCloudinaryLocator(document);
    const ttlSeconds = resolveTtlSeconds();
    const expiresAtUnix = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signedUrl = buildSignedUrl(locator, expiresAtUnix);

    await Promise.all([
      persistResolvedLocator(document.id, locator).catch(() => null),
      auditService.log({
        actorId: auth.userId,
        action: AUDIT_ACTIONS.DOCUMENT_ACCESSED,
        entityType: 'Document',
        entityId: document.id,
        newValues: {
          accessMode: 'SIGNED_URL',
          resourceType: locator.resourceType,
          deliveryType: locator.deliveryType,
          expiresAt: new Date(expiresAtUnix * 1000).toISOString()
        },
        req
      })
    ]);

    return {
      fileId: document.id,
      fileName: document.fileName,
      mimeType: document.mimeType,
      fileSize: document.fileSize,
      expiresAt: new Date(expiresAtUnix * 1000).toISOString(),
      signedUrl
    };
  },

  async streamFile(fileId, auth, req, res) {
    const { signedUrl, fileName, mimeType } = await this.getSignedAccess(fileId, auth, req);
    const upstream = await fetch(signedUrl);
    if (!upstream.ok || !upstream.body) {
      throw new AppError('Unable to fetch the file from storage provider.', 502);
    }

    res.setHeader('Content-Type', mimeType || upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName || 'file')}"`);
    res.setHeader('Cache-Control', 'no-store');

    const nodeStream = Readable.fromWeb(upstream.body);
    nodeStream.pipe(res);
  }
};

module.exports = fileAccessService;
