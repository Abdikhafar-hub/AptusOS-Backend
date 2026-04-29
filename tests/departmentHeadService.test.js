const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../src/services/departmentHeadService.js');

function loadWithMocks(mocks) {
  delete require.cache[servicePath];

  const entries = Object.entries(mocks || {});
  for (const [modulePath, mockedExports] of entries) {
    const resolved = require.resolve(modulePath);
    require.cache[resolved] = {
      id: resolved,
      filename: resolved,
      loaded: true,
      exports: mockedExports
    };
  }

  return require(servicePath);
}

function buildBaseMocks(overrides = {}) {
  const prisma = {
    user: {
      findFirst: async () => ({ id: 'head-1', departmentId: 'dep-1' }),
      findUnique: async () => ({ departmentId: 'dep-1' }),
      findMany: async () => [],
      count: async () => 0
    },
    leaveRequest: {
      findFirst: async () => ({ id: 'leave-1', approvalRequestId: 'approval-1' })
    },
    conversationParticipant: {
      findMany: async () => []
    },
    message: {
      count: async () => 0
    },
    $transaction: async (items) => Promise.all(items)
  };

  return {
    '../src/prisma/client': prisma,
    '../src/services/taskService': { create: async () => ({ id: 'task-1' }) },
    '../src/services/hrService': {
      listLeaveRequests: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      listAttendance: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } })
    },
    '../src/services/approvalService': { act: async () => ({ id: 'approval-1', status: 'APPROVED' }) },
    '../src/services/documentService': {
      list: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      upload: async () => ({ id: 'doc-1' }),
      archive: async () => true
    },
    '../src/services/communicationService': {
      listInbox: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      listSent: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      getThread: async () => ({ id: 'thread-1', messages: [] }),
      sendMail: async () => ({ threadId: 'thread-1' })
    },
    '../src/services/dashboardService': { departmentHead: async () => ({ summary: {} }) },
    '../src/services/auditPresentationService': { presentAuditLogs: async () => [] },
    ...overrides
  };
}

test('listStaff enforces current user department scope', async () => {
  let capturedWhere = null;
  const mocks = buildBaseMocks({
    '../src/prisma/client': {
      user: {
        findFirst: async () => ({ id: 'head-1', departmentId: 'dep-1' }),
        findUnique: async () => ({ departmentId: 'dep-1' }),
        findMany: async ({ where }) => {
          capturedWhere = where;
          return [];
        },
        count: async () => 0
      },
      $transaction: async (items) => Promise.all(items)
    }
  });

  const service = loadWithMocks(mocks);
  await service.listStaff({ userId: 'head-1', roleName: 'DEPARTMENT_HEAD' }, { page: 1, limit: 10 });

  assert.equal(capturedWhere.departmentId, 'dep-1');
});

test('createTask rejects assignment outside department', async () => {
  const mocks = buildBaseMocks({
    '../src/prisma/client': {
      user: {
        findFirst: async ({ where }) => {
          if (where.id === 'head-1') return { id: 'head-1', departmentId: 'dep-1' };
          return null;
        }
      }
    },
    '../src/services/taskService': {
      create: async () => {
        throw new Error('should not be called');
      }
    }
  });

  const service = loadWithMocks(mocks);

  await assert.rejects(
    () => service.createTask(
      { userId: 'head-1', roleName: 'DEPARTMENT_HEAD' },
      { title: 'Inventory Check', assignedToId: 'outside-user' },
      {}
    ),
    (error) => error && error.statusCode === 422
  );
});

test('approveLeave blocks leave request outside department', async () => {
  const mocks = buildBaseMocks({
    '../src/prisma/client': {
      user: {
        findFirst: async () => ({ id: 'head-1', departmentId: 'dep-1' })
      },
      leaveRequest: {
        findFirst: async () => null
      }
    }
  });

  const service = loadWithMocks(mocks);

  await assert.rejects(
    () => service.approveLeave(
      { userId: 'head-1', roleName: 'DEPARTMENT_HEAD' },
      'leave-other-department',
      'approve',
      {}
    ),
    (error) => error && error.statusCode === 404
  );
});

test('listInbox returns recipient-based inbox and unread counts plus sender-based sent count', async () => {
  const baseDate = new Date('2026-04-28T08:00:00.000Z');
  const unreadDate = new Date('2026-04-28T10:00:00.000Z');
  const oldDate = new Date('2026-04-28T06:00:00.000Z');

  const mocks = buildBaseMocks({
    '../src/prisma/client': {
      user: {
        findFirst: async () => ({ id: 'head-1', departmentId: 'dep-1' })
      },
      conversationParticipant: {
        findMany: async () => [
          {
            lastReadAt: baseDate,
            conversation: {
              messages: [{ createdAt: unreadDate }, { createdAt: oldDate }]
            }
          }
        ]
      },
      message: {
        count: async () => 5
      },
      $transaction: async (items) => Promise.all(items)
    },
    '../src/services/communicationService': {
      listInbox: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      listSent: async () => ({ items: [], meta: { total: 0, page: 1, limit: 10, totalPages: 0 } }),
      getThread: async () => ({ id: 'thread-1', messages: [] }),
      sendMail: async () => ({ threadId: 'thread-1' })
    }
  });

  const service = loadWithMocks(mocks);
  const result = await service.listInbox({ userId: 'head-1', roleName: 'DEPARTMENT_HEAD' }, { page: 1, limit: 10 });

  assert.equal(result.counts.unreadCount, 1);
  assert.equal(result.counts.inboxCount, 1);
  assert.equal(result.counts.sentCount, 5);
});
