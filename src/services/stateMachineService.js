const AppError = require('../utils/AppError');

const MACHINES = {
  LEAVE: {
    PENDING: ['APPROVED', 'REJECTED'],
    APPROVED: ['LOCKED'],
    REJECTED: [],
    LOCKED: []
  },
  FINANCE_REQUEST: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
    APPROVED: ['PAID'],
    PAID: [],
    REJECTED: [],
    CANCELLED: []
  },
  APPROVAL: {
    PENDING: ['APPROVED', 'REJECTED', 'NEEDS_MORE_INFO', 'CANCELLED'],
    NEEDS_MORE_INFO: ['PENDING', 'CANCELLED'],
    APPROVED: [],
    REJECTED: [],
    CANCELLED: []
  },
  TASK: {
    TODO: ['IN_PROGRESS', 'CANCELLED'],
    IN_PROGRESS: ['BLOCKED', 'IN_REVIEW', 'CANCELLED'],
    BLOCKED: ['IN_PROGRESS', 'CANCELLED'],
    IN_REVIEW: ['COMPLETED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: []
  },
  LOGISTICS_TASK: {
    PENDING: ['IN_PROGRESS', 'DELAYED', 'FAILED'],
    IN_PROGRESS: ['AWAITING_CLEARANCE', 'IN_TRANSIT', 'DELAYED', 'FAILED', 'COMPLETED'],
    AWAITING_CLEARANCE: ['IN_TRANSIT', 'DELAYED', 'FAILED', 'COMPLETED'],
    IN_TRANSIT: ['DELAYED', 'FAILED', 'COMPLETED'],
    DELAYED: ['IN_PROGRESS', 'AWAITING_CLEARANCE', 'IN_TRANSIT', 'FAILED', 'COMPLETED'],
    COMPLETED: [],
    FAILED: []
  },
  PAYROLL: {
    PENDING: ['APPROVED', 'REJECTED'],
    APPROVED: ['LOCKED'],
    REJECTED: [],
    LOCKED: []
  },
  CUSTOMER_ONBOARDING: {
    DRAFT: ['SUBMITTED'],
    SUBMITTED: ['UNDER_REVIEW', 'REJECTED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED', 'SUSPENDED'],
    APPROVED: ['LOCKED', 'SUSPENDED'],
    REJECTED: [],
    SUSPENDED: ['UNDER_REVIEW'],
    LOCKED: []
  },
  COMPLIANCE_ITEM: {
    OPEN: ['IN_PROGRESS', 'ARCHIVED'],
    IN_PROGRESS: ['UNDER_REVIEW', 'ARCHIVED'],
    UNDER_REVIEW: ['COMPLETED', 'OPEN', 'ARCHIVED'],
    COMPLETED: ['ARCHIVED'],
    ARCHIVED: []
  },
  COMPLAINT: {
    OPEN: ['INVESTIGATING', 'RESOLVED', 'CLOSED'],
    INVESTIGATING: ['RESOLVED', 'CLOSED'],
    RESOLVED: ['CLOSED'],
    CLOSED: []
  },
  INCIDENT: {
    OPEN: ['INVESTIGATING'],
    INVESTIGATING: ['RESOLVED'],
    RESOLVED: ['CLOSED'],
    CLOSED: []
  },
  REQUISITION: {
    DRAFT: ['SUBMITTED', 'CANCELLED'],
    SUBMITTED: ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'CANCELLED'],
    UNDER_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
    APPROVED: ['FULFILLED'],
    FULFILLED: ['LOCKED'],
    REJECTED: [],
    CANCELLED: [],
    LOCKED: []
  },
  PERFORMANCE_REVIEW: {
    NOT_STARTED: ['SELF_REVIEW_PENDING'],
    SELF_REVIEW_PENDING: ['MANAGER_REVIEW_PENDING'],
    MANAGER_REVIEW_PENDING: ['HR_REVIEW_PENDING'],
    HR_REVIEW_PENDING: ['COMPLETED'],
    COMPLETED: ['LOCKED'],
    LOCKED: []
  }
};

const stateMachineService = {
  getMachine(name) {
    const machine = MACHINES[name];
    if (!machine) throw new AppError(`Unknown state machine: ${name}`, 500);
    return machine;
  },

  assertTransition(machineName, currentState, nextState) {
    const machine = this.getMachine(machineName);
    const allowed = machine[currentState] || [];
    if (!allowed.includes(nextState)) {
      throw new AppError(`${machineName} transition ${currentState} -> ${nextState} is not allowed`, 400);
    }
  },

  isFinal(machineName, state) {
    const machine = this.getMachine(machineName);
    return (machine[state] || []).length === 0;
  }
};

module.exports = stateMachineService;
