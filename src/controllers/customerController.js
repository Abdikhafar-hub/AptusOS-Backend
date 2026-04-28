const customerOnboardingService = require('../services/customerOnboardingService');
const asyncHandler = require('../utils/asyncHandler');
const { success } = require('../utils/responses');

module.exports = {
  list: asyncHandler(async (req, res) => success(res, 'Customer onboarding records', await customerOnboardingService.list(req.auth, req.query))),
  get: asyncHandler(async (req, res) => success(res, 'Customer onboarding record', await customerOnboardingService.get(req.params.id, req.auth))),
  create: asyncHandler(async (req, res) => success(res, 'Customer onboarding record created', await customerOnboardingService.create(req.auth, req.body, req), 201)),
  update: asyncHandler(async (req, res) => success(res, 'Customer onboarding record updated', await customerOnboardingService.update(req.params.id, req.auth, req.body, req))),
  review: asyncHandler(async (req, res) => {
    const rawDecision = String(
      req.body?.decision
      || req.body?.action
      || req.body?.status
      || req.body?.type
      || 'SUBMITTED'
    )
      .trim()
      .toUpperCase();

    const decisionAliases = {
      SUBMIT: 'SUBMITTED',
      SEND_TO_APPROVAL: 'SUBMITTED',
      SEND_FOR_APPROVAL: 'SUBMITTED'
    };

    const allowedDecisions = new Set(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']);
    const mappedDecision = decisionAliases[rawDecision] || rawDecision || 'SUBMITTED';
    const normalizedDecision = allowedDecisions.has(mappedDecision) ? mappedDecision : 'SUBMITTED';
    const comment = req.body?.comment || req.body?.reason || req.body?.note || undefined;

    return success(
      res,
      'Customer onboarding record updated',
      await customerOnboardingService.review(
        req.params.id,
        req.auth,
        normalizedDecision,
        comment,
        req.body?.reviewChecklist,
        req
      )
    );
  })
};
