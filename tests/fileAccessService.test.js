const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function loadWithMocks(servicePath, mocks) {
  const resolvedServicePath = path.resolve(__dirname, servicePath);
  delete require.cache[resolvedServicePath];

  for (const [modulePath, mockedExports] of Object.entries(mocks || {})) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: mockedExports
    };
  }

  return require(resolvedServicePath);
}

test('getSignedAccess returns short-lived signed URL and writes audit log', async () => {
  const captured = { audit: null, expiresAt: null };

  const fileAccessService = loadWithMocks('../src/services/fileAccessService.js', {
    '../src/prisma/client': {
      document: {
        findFirst: async () => ({
          id: 'doc-1',
          fileName: 'payroll.pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          ownerType: 'FINANCE',
          ownerId: null,
          uploadedById: 'user-1',
          departmentId: 'dep-1',
          visibility: 'PRIVATE',
          cloudinaryPublicId: 'aptus-os/finance/payroll_2026',
          cloudinaryResourceType: 'raw',
          cloudinaryDeliveryType: 'authenticated'
        })
      }
    },
    '../src/services/accessControlService': {
      assertDocumentAccess: () => true
    },
    '../src/services/auditService': {
      log: async (payload) => {
        captured.audit = payload;
      }
    },
    '../src/constants/auditActions': {
      AUDIT_ACTIONS: { DOCUMENT_ACCESSED: 'DOCUMENT_ACCESSED' }
    },
    '../src/config/cloudinary': {
      api: {
        resource: async () => ({ format: 'pdf' })
      },
      utils: {
        private_download_url: (_publicId, _format, options) => {
          captured.expiresAt = options.expires_at;
          return `https://signed.example.com/file.pdf?exp=${options.expires_at}`;
        }
      },
      url: () => 'https://signed.example.com/fallback'
    },
    '../src/config/env': {
      cloudinary: {
        cloudName: 'demo',
        apiKey: 'key',
        apiSecret: 'secret',
        signedUrlTtlSeconds: 90
      }
    }
  });

  const result = await fileAccessService.getSignedAccess('doc-1', { userId: 'user-1' }, {});

  assert.equal(result.fileId, 'doc-1');
  assert.match(result.signedUrl, /^https:\/\/signed\.example\.com\/file\.pdf\?exp=\d+$/);
  assert.ok(captured.expiresAt);
  assert.equal(captured.audit.action, 'DOCUMENT_ACCESSED');
  assert.equal(captured.audit.entityId, 'doc-1');
});

test('getSignedAccess returns 404 for missing file', async () => {
  const fileAccessService = loadWithMocks('../src/services/fileAccessService.js', {
    '../src/prisma/client': {
      document: { findFirst: async () => null }
    },
    '../src/services/accessControlService': {
      assertDocumentAccess: () => true
    },
    '../src/services/auditService': {
      log: async () => ({})
    },
    '../src/constants/auditActions': {
      AUDIT_ACTIONS: { DOCUMENT_ACCESSED: 'DOCUMENT_ACCESSED' }
    },
    '../src/config/cloudinary': {
      api: {
        resource: async () => {
          const error = new Error('Resource not found');
          error.http_code = 404;
          throw error;
        }
      },
      utils: { private_download_url: () => 'https://signed.example.com/file.pdf' },
      url: () => 'https://signed.example.com/fallback'
    },
    '../src/config/env': {
      cloudinary: {
        cloudName: 'demo',
        apiKey: 'key',
        apiSecret: 'secret',
        signedUrlTtlSeconds: 90
      }
    }
  });

  await assert.rejects(
    () => fileAccessService.getSignedAccess('missing-id', { userId: 'user-1' }, {}),
    (error) => error?.statusCode === 404
  );
});

test('getSignedAccess rejects unauthorized access with 403', async () => {
  const fileAccessService = loadWithMocks('../src/services/fileAccessService.js', {
    '../src/prisma/client': {
      document: {
        findFirst: async () => ({
          id: 'doc-1',
          fileName: 'restricted.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
          ownerType: 'FINANCE',
          ownerId: null,
          uploadedById: 'user-2',
          departmentId: 'dep-2',
          visibility: 'PRIVATE',
          cloudinaryPublicId: 'aptus-os/finance/restricted_2026',
          cloudinaryResourceType: 'raw',
          cloudinaryDeliveryType: 'authenticated'
        })
      }
    },
    '../src/services/accessControlService': {
      assertDocumentAccess: () => {
        const error = new Error('Forbidden');
        error.statusCode = 403;
        throw error;
      }
    },
    '../src/services/auditService': {
      log: async () => ({})
    },
    '../src/constants/auditActions': {
      AUDIT_ACTIONS: { DOCUMENT_ACCESSED: 'DOCUMENT_ACCESSED' }
    },
    '../src/config/cloudinary': {
      api: {
        resource: async () => ({ format: 'pdf' })
      },
      utils: { private_download_url: () => 'https://signed.example.com/file.pdf' },
      url: () => 'https://signed.example.com/fallback'
    },
    '../src/config/env': {
      cloudinary: {
        cloudName: 'demo',
        apiKey: 'key',
        apiSecret: 'secret',
        signedUrlTtlSeconds: 90
      }
    }
  });

  await assert.rejects(
    () => fileAccessService.getSignedAccess('doc-1', { userId: 'user-1' }, {}),
    (error) => error?.statusCode === 403
  );
});
