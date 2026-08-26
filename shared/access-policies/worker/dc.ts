import { definePolicy, registerPolicy, type PolicyContext } from '../index';
import { evaluateDcEligibility, rollingWindow, parseDenialLetterValidityMonths } from '../../sitespecific/bao/dc-eligibility';

/**
 * Access to a worker's Disability Credit screen.
 *
 * Staff always see the tab (they open and work cases). A member sees it for
 * their OWN record when they either already have a DC case (any status —
 * history stays visible) or are currently ELIGIBLE to open one, evaluated by
 * the exact shared eligibility core the server uses. Ineligible members are
 * never offered case creation and the same rule gates the API.
 *
 * skipCache: eligibility and case existence flip with hour uploads and case
 * writes, so the result must not be cached against stale state.
 */
const policy = definePolicy({
  id: 'worker.dc',
  description: "Access a worker's Disability Credit screen",
  scope: 'entity',
  entityType: 'worker',
  component: 'sitespecific.bao',
  skipCache: true,

  describeRequirements: () => [
    { all: [{ permission: 'staff' }] },
    {
      all: [
        { policy: 'worker.mine' },
        { attribute: 'worker has a DC case or is currently DC-eligible' },
      ],
    },
  ],

  async evaluate(ctx: PolicyContext) {
    if (!ctx.entityId) {
      return { granted: false, reason: 'No worker specified' };
    }

    if (await ctx.hasPermission('staff')) {
      return { granted: true, reason: 'Staff access' };
    }

    const isMine = await ctx.checkPolicy('worker.mine', ctx.entityId);
    if (!isMine) {
      return { granted: false, reason: 'No access to this worker' };
    }

    try {
      const dc = ctx.storage.baoDisabilityCredit;
      const cases = await dc.listCasesForWorker(ctx.entityId);
      if (cases.length > 0) {
        return { granted: true, reason: 'Own record with a DC case' };
      }

      const asOfYmd = new Date().toISOString().slice(0, 10);
      const { startMonthYmd, endMonthYmd } = rollingWindow(asOfYmd);
      const [fmlaMonths, letters, validityVar] = await Promise.all([
        dc.getFmlaMonthsForWorker(ctx.entityId, startMonthYmd, endMonthYmd),
        dc.listNonVoidedDenialLettersForWorker(ctx.entityId),
        ctx.storage.variables.getByName('bao_dc_denial_letter_validity_months'),
      ]);
      const result = evaluateDcEligibility({
        asOfYmd,
        fmlaMonths,
        denialLetters: letters,
        denialLetterValidityMonths: parseDenialLetterValidityMonths(validityVar?.value),
      });
      if (result.eligible) {
        return { granted: true, reason: 'Own record, currently DC-eligible' };
      }
      return { granted: false, reason: 'Not eligible for Disability Credit' };
    } catch (error) {
      // Component tables not present (component disabled mid-flight, etc).
      return { granted: false, reason: 'Disability Credit is not available' };
    }
  },
});

registerPolicy(policy);
export default policy;
