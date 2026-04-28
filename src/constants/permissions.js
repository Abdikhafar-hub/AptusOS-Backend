const PERMISSIONS = [
  'users:create', 'users:read', 'users:update', 'users:deactivate',
  'roles:manage', 'permissions:manage',
  'departments:manage', 'departments:read',
  'documents:create', 'documents:read', 'documents:approve', 'documents:delete',
  'approvals:create', 'approvals:act', 'approvals:read',
  'tasks:create', 'tasks:update', 'tasks:read',
  'communication:use', 'announcements:publish',
  'hr:manage', 'hr:read',
  'payroll:manage', 'payroll:read',
  'finance:manage', 'finance:read', 'accounts:manage',
  'customers:manage', 'sales_compliance:manage', 'compliance:manage',
  'operations:manage', 'trainings:manage', 'performance:manage',
  'reports:read', 'audit_logs:read', 'settings:manage'
];

module.exports = { PERMISSIONS };
