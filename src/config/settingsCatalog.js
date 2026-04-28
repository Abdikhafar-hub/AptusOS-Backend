const { ROLES } = require('../constants/roles');

const ALL_ROLES = Object.freeze([
  ROLES.GENERAL_MANAGER,
  ROLES.DEPARTMENT_HEAD,
  ROLES.HR_MANAGER,
  ROLES.FINANCE_ACCOUNTS_MANAGER,
  ROLES.SALES_COMPLIANCE_OFFICER,
  ROLES.OPERATIONS_PROCUREMENT_OFFICER,
  ROLES.EMPLOYEE
]);

const SETTING_SCOPE_TYPES = Object.freeze({
  ORGANIZATION: 'ORGANIZATION',
  DEPARTMENT: 'DEPARTMENT',
  ROLE: 'ROLE',
  USER: 'USER'
});

const SETTINGS_SECTION_DEFINITIONS = Object.freeze({
  organization_profile: {
    key: 'organization_profile',
    title: 'Organization Profile',
    description: 'Primary company profile, contact, and locale settings.',
    scopeType: SETTING_SCOPE_TYPES.ORGANIZATION,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.DEPARTMENT_HEAD],
    editableBy: [ROLES.GENERAL_MANAGER],
    fields: [
      { key: 'organizationName', label: 'Organization name', type: 'text', placeholder: 'AptusOS Internal Operations' },
      { key: 'registrationNumber', label: 'Registration number', type: 'text', placeholder: 'REG-001' },
      { key: 'primaryEmail', label: 'Primary email', type: 'email', placeholder: 'ops@aptuspharma.local' },
      { key: 'primaryPhone', label: 'Primary phone', type: 'text', placeholder: '+254700000000' },
      { key: 'headquartersAddress', label: 'Headquarters address', type: 'textarea', placeholder: 'Nairobi, Kenya' },
      { key: 'timezone', label: 'Timezone', type: 'select', options: [{ label: 'Africa/Nairobi', value: 'Africa/Nairobi' }, { label: 'UTC', value: 'UTC' }] },
      { key: 'currency', label: 'Currency', type: 'select', options: [{ label: 'KES', value: 'KES' }, { label: 'USD', value: 'USD' }] },
      { key: 'country', label: 'Country', type: 'text', placeholder: 'Kenya' }
    ],
    defaults: {
      organizationName: 'AptusOS Internal Operations',
      registrationNumber: 'APTUS-ORG-001',
      primaryEmail: 'ops@aptuspharma.local',
      primaryPhone: '+254700000000',
      headquartersAddress: 'Nairobi, Kenya',
      timezone: 'Africa/Nairobi',
      currency: 'KES',
      country: 'Kenya'
    }
  },
  company_branding: {
    key: 'company_branding',
    title: 'Company Branding',
    description: 'Visual identity settings for logo, colors, and product identity surfaces.',
    scopeType: SETTING_SCOPE_TYPES.ORGANIZATION,
    visibleTo: [ROLES.GENERAL_MANAGER],
    editableBy: [ROLES.GENERAL_MANAGER],
    fields: [
      { key: 'logoUrl', label: 'Logo URL', type: 'url', placeholder: '/aptuslogoo.png' },
      { key: 'primaryColor', label: 'Primary color', type: 'color' },
      { key: 'secondaryColor', label: 'Secondary color', type: 'color' },
      { key: 'accentColor', label: 'Accent color', type: 'color' },
      { key: 'emailSignature', label: 'Email signature', type: 'textarea', placeholder: 'AptusOS Internal Operations Team' }
    ],
    defaults: {
      logoUrl: '/aptuslogoo.png',
      primaryColor: '#1f4bb6',
      secondaryColor: '#0f172a',
      accentColor: '#22c55e',
      emailSignature: 'AptusOS Internal Operations Team'
    }
  },
  departments_setup: {
    key: 'departments_setup',
    title: 'Departments Setup',
    description: 'Department structure and delegation behavior for operational teams.',
    scopeType: SETTING_SCOPE_TYPES.DEPARTMENT,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    fields: [
      { key: 'departmentCodePrefix', label: 'Department code prefix', type: 'text', placeholder: 'APT' },
      { key: 'autoCreateDepartmentChannel', label: 'Auto-create department channel', type: 'boolean' },
      { key: 'allowCrossDepartmentAssignments', label: 'Allow cross-department assignments', type: 'boolean' },
      { key: 'requireDepartmentHeadApproval', label: 'Require department-head approval', type: 'boolean' }
    ],
    defaults: {
      departmentCodePrefix: 'APT',
      autoCreateDepartmentChannel: true,
      allowCrossDepartmentAssignments: false,
      requireDepartmentHeadApproval: true
    }
  },
  user_preferences: {
    key: 'user_preferences',
    title: 'Staff/User Preferences',
    description: 'Personal UX preferences for each signed-in user.',
    scopeType: SETTING_SCOPE_TYPES.USER,
    visibleTo: [...ALL_ROLES],
    editableBy: [...ALL_ROLES],
    fields: [
      { key: 'language', label: 'Language', type: 'select', options: [{ label: 'English', value: 'en' }] },
      { key: 'dateFormat', label: 'Date format', type: 'select', options: [{ label: 'DD/MM/YYYY', value: 'DD/MM/YYYY' }, { label: 'MM/DD/YYYY', value: 'MM/DD/YYYY' }] },
      { key: 'timeFormat', label: 'Time format', type: 'select', options: [{ label: '24-hour', value: '24h' }, { label: '12-hour', value: '12h' }] },
      { key: 'compactMode', label: 'Compact layout mode', type: 'boolean' },
      { key: 'defaultLandingPage', label: 'Default landing page', type: 'text', placeholder: '/dashboard' }
    ],
    defaults: {
      language: 'en',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      compactMode: false,
      defaultLandingPage: '/dashboard'
    }
  },
  role_permissions_overview: {
    key: 'role_permissions_overview',
    title: 'Role Permissions Overview',
    description: 'Role-level permission and access posture summary.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER],
    editableBy: [ROLES.GENERAL_MANAGER],
    fields: [
      { key: 'showPermissionWarnings', label: 'Show permission warnings', type: 'boolean' },
      { key: 'allowRoleCustomNotes', label: 'Allow role custom notes', type: 'boolean' },
      { key: 'permissionsSummary', label: 'Permission summary notes', type: 'textarea', placeholder: 'Role capability notes' }
    ],
    defaults: {
      showPermissionWarnings: true,
      allowRoleCustomNotes: true,
      permissionsSummary: 'Role permissions are controlled by system policy and audited.'
    }
  },
  notification_preferences: {
    key: 'notification_preferences',
    title: 'Notification Preferences',
    description: 'Delivery preferences for alerts and reminders.',
    scopeType: SETTING_SCOPE_TYPES.USER,
    visibleTo: [...ALL_ROLES],
    editableBy: [...ALL_ROLES],
    fields: [
      { key: 'inAppEnabled', label: 'In-app notifications', type: 'boolean' },
      { key: 'emailEnabled', label: 'Email notifications', type: 'boolean' },
      { key: 'digestFrequency', label: 'Digest frequency', type: 'select', options: [{ label: 'Off', value: 'off' }, { label: 'Daily', value: 'daily' }, { label: 'Weekly', value: 'weekly' }] },
      { key: 'approvalAlerts', label: 'Approval alerts', type: 'boolean' },
      { key: 'taskReminders', label: 'Task reminders', type: 'boolean' },
      { key: 'documentExpiryAlerts', label: 'Document expiry alerts', type: 'boolean' },
      { key: 'securityAlerts', label: 'Security alerts', type: 'boolean' }
    ],
    defaults: {
      inAppEnabled: true,
      emailEnabled: false,
      digestFrequency: 'daily',
      approvalAlerts: true,
      taskReminders: true,
      documentExpiryAlerts: true,
      securityAlerts: true
    }
  },
  approval_workflow: {
    key: 'approval_workflow',
    title: 'Approval Workflow Settings',
    description: 'Approval sequence, SLA, and escalation defaults.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.HR_MANAGER, ROLES.FINANCE_ACCOUNTS_MANAGER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.HR_MANAGER, ROLES.FINANCE_ACCOUNTS_MANAGER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    fields: [
      { key: 'requireSequentialApprovals', label: 'Require sequential approvals', type: 'boolean' },
      { key: 'defaultApprovalSlaHours', label: 'Default approval SLA (hours)', type: 'number', min: 1, max: 240, step: 1 },
      { key: 'escalateAfterHours', label: 'Escalate after (hours)', type: 'number', min: 1, max: 240, step: 1 },
      { key: 'allowSelfApproval', label: 'Allow self approval', type: 'boolean' },
      { key: 'requireCommentOnReject', label: 'Require rejection comment', type: 'boolean' }
    ],
    defaults: {
      requireSequentialApprovals: true,
      defaultApprovalSlaHours: 24,
      escalateAfterHours: 48,
      allowSelfApproval: false,
      requireCommentOnReject: true
    }
  },
  task_settings: {
    key: 'task_settings',
    title: 'Task Settings',
    description: 'Task assignment and SLA defaults by role.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.DEPARTMENT_HEAD, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    fields: [
      { key: 'defaultPriority', label: 'Default priority', type: 'select', options: [{ label: 'Low', value: 'LOW' }, { label: 'Medium', value: 'MEDIUM' }, { label: 'High', value: 'HIGH' }] },
      { key: 'defaultSlaDays', label: 'Default SLA (days)', type: 'number', min: 1, max: 90, step: 1 },
      { key: 'allowTaskReassignment', label: 'Allow task reassignment', type: 'boolean' },
      { key: 'requireTaskDescription', label: 'Require task description', type: 'boolean' }
    ],
    defaults: {
      defaultPriority: 'MEDIUM',
      defaultSlaDays: 7,
      allowTaskReassignment: true,
      requireTaskDescription: true
    }
  },
  document_settings: {
    key: 'document_settings',
    title: 'Document Settings',
    description: 'Document lifecycle, retention, and sharing controls.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.HR_MANAGER, ROLES.SALES_COMPLIANCE_OFFICER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.HR_MANAGER, ROLES.SALES_COMPLIANCE_OFFICER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    fields: [
      { key: 'retentionPeriodMonths', label: 'Retention period (months)', type: 'number', min: 1, max: 120, step: 1 },
      { key: 'requireVersioning', label: 'Require versioning', type: 'boolean' },
      { key: 'requireApprovalForCompanyDocs', label: 'Require approval for company docs', type: 'boolean' },
      { key: 'allowExternalSharing', label: 'Allow external sharing', type: 'boolean' }
    ],
    defaults: {
      retentionPeriodMonths: 36,
      requireVersioning: true,
      requireApprovalForCompanyDocs: true,
      allowExternalSharing: false
    }
  },
  security_settings: {
    key: 'security_settings',
    title: 'Security Settings',
    description: 'Security controls for sessions, passwords, and MFA.',
    scopeType: SETTING_SCOPE_TYPES.ORGANIZATION,
    visibleTo: [ROLES.GENERAL_MANAGER],
    editableBy: [ROLES.GENERAL_MANAGER],
    fields: [
      { key: 'enforceMfa', label: 'Enforce MFA', type: 'boolean' },
      { key: 'sessionTimeoutMinutes', label: 'Session timeout (minutes)', type: 'number', min: 5, max: 1440, step: 5 },
      { key: 'passwordRotationDays', label: 'Password rotation (days)', type: 'number', min: 30, max: 365, step: 1 },
      { key: 'allowIpRestriction', label: 'Allow IP restrictions', type: 'boolean' }
    ],
    defaults: {
      enforceMfa: false,
      sessionTimeoutMinutes: 120,
      passwordRotationDays: 90,
      allowIpRestriction: false
    }
  },
  billing_finance: {
    key: 'billing_finance',
    title: 'Billing & Finance Settings',
    description: 'Financial controls for budgeting, terms, and payment approvals.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.FINANCE_ACCOUNTS_MANAGER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.FINANCE_ACCOUNTS_MANAGER],
    fields: [
      { key: 'fiscalYearStartMonth', label: 'Fiscal year start month', type: 'number', min: 1, max: 12, step: 1 },
      { key: 'defaultPaymentTermsDays', label: 'Default payment terms (days)', type: 'number', min: 1, max: 180, step: 1 },
      { key: 'budgetLockAfterApproval', label: 'Lock budgets after approval', type: 'boolean' },
      { key: 'requireTwoStepFinanceApproval', label: 'Require two-step finance approval', type: 'boolean' }
    ],
    defaults: {
      fiscalYearStartMonth: 1,
      defaultPaymentTermsDays: 30,
      budgetLockAfterApproval: true,
      requireTwoStepFinanceApproval: true
    }
  },
  system_preferences: {
    key: 'system_preferences',
    title: 'System Preferences',
    description: 'Global platform preferences and operational safeguards.',
    scopeType: SETTING_SCOPE_TYPES.ORGANIZATION,
    visibleTo: [ROLES.GENERAL_MANAGER],
    editableBy: [ROLES.GENERAL_MANAGER],
    fields: [
      { key: 'maintenanceMode', label: 'Maintenance mode', type: 'boolean' },
      { key: 'auditLogRetentionDays', label: 'Audit log retention (days)', type: 'number', min: 30, max: 3650, step: 1 },
      { key: 'enablePublicStatusPage', label: 'Enable public status page', type: 'boolean' },
      { key: 'defaultLandingModule', label: 'Default landing module', type: 'text', placeholder: '/dashboard' }
    ],
    defaults: {
      maintenanceMode: false,
      auditLogRetentionDays: 365,
      enablePublicStatusPage: false,
      defaultLandingModule: '/dashboard'
    }
  },
  hr_staff_settings: {
    key: 'hr_staff_settings',
    title: 'HR Staff Settings',
    description: 'HR-specific workforce policy defaults and controls.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.HR_MANAGER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.HR_MANAGER],
    fields: [
      { key: 'probationPeriodMonths', label: 'Probation period (months)', type: 'number', min: 1, max: 24, step: 1 },
      { key: 'requireExitChecklist', label: 'Require exit checklist', type: 'boolean' },
      { key: 'allowSelfServiceProfileUpdate', label: 'Allow self-service profile updates', type: 'boolean' }
    ],
    defaults: {
      probationPeriodMonths: 3,
      requireExitChecklist: true,
      allowSelfServiceProfileUpdate: true
    }
  },
  sales_customer_settings: {
    key: 'sales_customer_settings',
    title: 'Sales Customer Settings',
    description: 'Sales and customer compliance defaults for onboarding and review cadence.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.SALES_COMPLIANCE_OFFICER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.SALES_COMPLIANCE_OFFICER],
    fields: [
      { key: 'requireCustomerComplianceDocs', label: 'Require customer compliance docs', type: 'boolean' },
      { key: 'defaultCustomerReviewCycleDays', label: 'Default customer review cycle (days)', type: 'number', min: 1, max: 365, step: 1 },
      { key: 'autoAssignSalesOfficer', label: 'Auto-assign sales officer', type: 'boolean' }
    ],
    defaults: {
      requireCustomerComplianceDocs: true,
      defaultCustomerReviewCycleDays: 30,
      autoAssignSalesOfficer: false
    }
  },
  operations_workflow_settings: {
    key: 'operations_workflow_settings',
    title: 'Operations Workflow Settings',
    description: 'Operations and procurement automation defaults.',
    scopeType: SETTING_SCOPE_TYPES.ROLE,
    visibleTo: [ROLES.GENERAL_MANAGER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    editableBy: [ROLES.GENERAL_MANAGER, ROLES.OPERATIONS_PROCUREMENT_OFFICER],
    fields: [
      { key: 'enableVendorScorecards', label: 'Enable vendor scorecards', type: 'boolean' },
      { key: 'requisitionAutoEscalationHours', label: 'Requisition auto-escalation (hours)', type: 'number', min: 1, max: 240, step: 1 },
      { key: 'requireProcurementDocumentBundle', label: 'Require procurement document bundle', type: 'boolean' }
    ],
    defaults: {
      enableVendorScorecards: true,
      requisitionAutoEscalationHours: 48,
      requireProcurementDocumentBundle: true
    }
  }
});

module.exports = {
  ALL_ROLES,
  SETTING_SCOPE_TYPES,
  SETTINGS_SECTION_DEFINITIONS
};
