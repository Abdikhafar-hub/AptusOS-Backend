const prisma = require('../prisma/client');
const AppError = require('../utils/AppError');

const entityConfig = {
  TASK: { model: 'task', ownerFields: ['assignedToId', 'assignedById'], relationField: 'taskId' },
  APPROVAL: { model: 'approvalRequest', ownerFields: ['requestedById', 'currentApproverId'], relationField: 'approvalId' },
  DOCUMENT: { model: 'document', ownerFields: ['uploadedById', 'approvedById', 'ownerId'], relationField: 'documentId' },
  LEAVE_REQUEST: { model: 'leaveRequest', ownerFields: ['employeeId'] },
  FINANCE_REQUEST: { model: 'financeRequest', ownerFields: ['requestedById'] },
  PERFORMANCE_REVIEW: { model: 'performanceReview', ownerFields: ['employeeId', 'reviewerId'] },
  COMPLIANCE_ITEM: { model: 'complianceItem', ownerFields: ['ownerId'] },
  COMPLAINT: { model: 'complaintEscalation', ownerFields: ['ownerId'] },
  RISK: { model: 'riskRegister', ownerFields: ['ownerId'] },
  INCIDENT: { model: 'incidentReport', ownerFields: ['reportedById'] },
  CUSTOMER_ISSUE: { model: 'customerIssue', ownerFields: ['reportedById', 'assignedToId'] },
  DISCOUNT_REQUEST: { model: 'discountRequest', ownerFields: ['requestedById'] },
  SALES_OPPORTUNITY: { model: 'salesOpportunity', ownerFields: ['ownerId'] },
  PRODUCT_FEEDBACK: { model: 'productFeedback', ownerFields: ['submittedById'] },
  VISIT_ROUTE: { model: 'visitRoute', ownerFields: ['assignedOfficerId'] },
  REQUISITION: { model: 'requisition', ownerFields: ['requestedById'] },
  CUSTOMER_ONBOARDING: { model: 'customerOnboarding', ownerFields: ['assignedOfficerId'] },
  HR_ACTION: { model: 'hRAction', ownerFields: ['employeeId', 'createdById'] },
  SEPARATION: { model: 'separation', ownerFields: ['employeeId'] },
  PAYSLIP: { model: 'payslip', ownerFields: ['employeeId', 'generatedById'] }
};

const workflowEntityService = {
  normalizeType(type) {
    return String(type || '').trim().toUpperCase();
  },

  getConfig(type) {
    const config = entityConfig[this.normalizeType(type)];
    if (!config) throw new AppError(`Unsupported workflow entity type: ${type}`, 400);
    return config;
  },

  async getEntity(type, id, select) {
    const config = this.getConfig(type);
    const entity = await prisma[config.model].findFirst({
      where: { id, ...(config.model !== 'approvalRequest' && config.model !== 'notification' ? { deletedAt: null } : {}) },
      select
    });
    if (!entity) throw new AppError(`${type} not found`, 404);
    return entity;
  },

  async getRecipients(type, id) {
    const config = this.getConfig(type);
    const entity = await this.getEntity(type, id);
    return [...new Set(config.ownerFields.map((field) => entity[field]).filter(Boolean))];
  },

  buildCommentRelations(type, entityId) {
    const config = this.getConfig(type);
    return config.relationField ? { [config.relationField]: entityId } : {};
  }
};

module.exports = workflowEntityService;
