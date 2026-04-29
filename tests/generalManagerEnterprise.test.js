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

test('governance settings update is restricted to GM', async () => {
  const governanceService = loadWithMocks('../src/services/governanceService.js', {
    '../src/prisma/client': {
      companySetting: { findMany: async () => [] }
    },
    '../src/services/accessControlService': {
      isGeneralManager: () => false
    },
    '../src/services/auditService': {
      log: async () => ({})
    }
  });

  await assert.rejects(
    () => governanceService.updateSettings({ userId: 'user-1', roleName: 'EMPLOYEE' }, [{ key: 'approvalSlaHours', value: 24 }]),
    (error) => error?.statusCode === 403
  );
});

test('governance settings persist validated values', async () => {
  const upserted = [];

  const governanceService = loadWithMocks('../src/services/governanceService.js', {
    '../src/prisma/client': {
      companySetting: {
        findMany: async () => [],
        upsert: async ({ create }) => {
          upserted.push(create);
          return { id: 'setting-1', ...create, updatedAt: new Date().toISOString() };
        }
      },
      $transaction: async (handler) => handler({
        companySetting: {
          upsert: async ({ create }) => {
            upserted.push(create);
            return { id: `setting-${upserted.length}`, ...create, updatedAt: new Date().toISOString() };
          }
        },
        auditLog: { create: async () => ({}) }
      })
    },
    '../src/services/accessControlService': {
      isGeneralManager: () => true
    },
    '../src/services/auditService': {
      log: async () => ({})
    }
  });

  const result = await governanceService.updateSettings(
    { userId: 'gm-1', roleName: 'GENERAL_MANAGER' },
    [{ key: 'approvalSlaHours', value: '36' }, { key: 'creditRiskThreshold', value: 85 }],
    {}
  );

  assert.equal(result.length, 2);
  assert.equal(upserted[0].key, 'approvalSlaHours');
  assert.equal(upserted[0].value, 36);
  assert.equal(upserted[1].key, 'creditRiskThreshold');
  assert.equal(upserted[1].value, 85);
});

test('escalation resolve allows delegated exec', async () => {
  const escalationService = loadWithMocks('../src/services/escalationService.js', {
    '../src/prisma/client': {
      escalationLog: {
        findUnique: async () => ({ id: 'esc-1', resolvedAt: null, resolutionNotes: null }),
        update: async ({ data }) => ({ id: 'esc-1', ...data })
      },
      delegation: {
        findFirst: async () => ({ id: 'del-1' })
      },
      user: {
        findMany: async () => [{ id: 'gm-1' }]
      },
      $transaction: async (handler) => handler({
        escalationLog: {
          update: async ({ data }) => ({ id: 'esc-1', ...data })
        },
        user: { findMany: async () => [{ id: 'gm-1' }] },
        notification: { createMany: async () => ({ count: 1 }) },
        auditLog: { create: async () => ({}) }
      })
    },
    '../src/services/accessControlService': {
      isGeneralManager: () => false
    },
    '../src/services/governanceService': {
      getResolvedMap: async () => ({})
    },
    '../src/services/notificationService': {
      createMany: async () => ({ count: 1 })
    },
    '../src/services/auditService': {
      log: async () => ({})
    },
    '../src/constants/roles': {
      ROLES: { GENERAL_MANAGER: 'GENERAL_MANAGER' }
    }
  });

  const resolved = await escalationService.resolve(
    { userId: 'delegate-1', roleName: 'OPERATIONS_PROCUREMENT_OFFICER' },
    'esc-1',
    { action: 'RESOLVE', resolutionNotes: 'Handled by delegated exec' },
    {}
  );

  assert.equal(resolved.id, 'esc-1');
  assert.equal(resolved.resolvedById, 'delegate-1');
});

test('escalation resolve blocks non-GM without delegation', async () => {
  const escalationService = loadWithMocks('../src/services/escalationService.js', {
    '../src/prisma/client': {
      escalationLog: {
        findUnique: async () => ({ id: 'esc-1', resolvedAt: null })
      },
      delegation: {
        findFirst: async () => null
      }
    },
    '../src/services/accessControlService': {
      isGeneralManager: () => false
    },
    '../src/services/governanceService': {
      getResolvedMap: async () => ({})
    },
    '../src/services/notificationService': {
      createMany: async () => ({ count: 1 })
    },
    '../src/services/auditService': {
      log: async () => ({})
    },
    '../src/constants/roles': {
      ROLES: { GENERAL_MANAGER: 'GENERAL_MANAGER' }
    }
  });

  await assert.rejects(
    () => escalationService.resolve({ userId: 'staff-1', roleName: 'EMPLOYEE' }, 'esc-1', { action: 'RESOLVE' }, {}),
    (error) => error?.statusCode === 403
  );
});

test('enterprise report mapping runs report service and writes audit', async () => {
  const generalManagerService = loadWithMocks('../src/services/generalManagerService.js', {
    '../src/prisma/client': {
      escalationLog: { findMany: async () => [] }
    },
    '../src/services/accessControlService': {
      isGeneralManager: () => true
    },
    '../src/services/governanceService': {
      getResolvedMap: async () => ({})
    },
    '../src/services/escalationService': {
      list: async () => ({ items: [] }),
      resolve: async () => ({ id: 'esc-1' }),
      refreshAutomaticEscalations: async () => ({ created: 0 })
    },
    '../src/services/financeService': {
      getEnterpriseFinanceSummary: async () => ({ netPosition: 1000 }),
      listEnterprisePayables: async () => ({ items: [] }),
      listEnterpriseReceivables: async () => ({ items: [] })
    },
    '../src/services/reportService': {
      runEnterprise: async () => ({ reportType: 'finance', columns: ['a'], rows: [{ a: 1 }], csvReady: true })
    },
    '../src/services/auditLogService': {
      list: async () => ({ items: [] })
    },
    '../src/services/communicationService': {
      unreadCount: async () => 0
    },
    '../src/services/auditService': {
      log: async () => ({})
    }
  });

  const result = await generalManagerService.runEnterpriseReport(
    { userId: 'gm-1', roleName: 'GENERAL_MANAGER' },
    { reportType: 'financeReport', filters: { dateFrom: '2026-01-01' } },
    {}
  );

  assert.equal(result.reportType, 'finance');
  assert.equal(result.rows.length, 1);
});

test('finance summary enforces RBAC', async () => {
  const financeService = loadWithMocks('../src/services/financeService.js', {
    '../src/prisma/client': {
      financeRequest: {
        aggregate: async () => ({ _sum: { amount: 0 }, _count: 0 }),
        groupBy: async () => []
      },
      department: {
        findMany: async () => []
      }
    },
    '../src/services/accessControlService': {
      isGeneralManager: () => false,
      isFinance: () => false
    },
    '../src/services/approvalService': {},
    '../src/services/auditService': {},
    '../src/services/notificationService': {},
    '../src/services/stateMachineService': {},
    '../src/services/domainGuardService': {},
    '../src/services/timelineService': {},
    '../src/services/approvalPolicyService': {}
  });

  await assert.rejects(
    () => financeService.getEnterpriseFinanceSummary({ userId: 'employee-1', roleName: 'EMPLOYEE' }, {}),
    (error) => error?.statusCode === 403
  );
});
