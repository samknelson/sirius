/**
 * Trustee outcomes on Benefit Appeal cases — Approve and Deny — and the
 * shared open-ended exemption grant an approval makes.
 *
 * Layering: the cases storage owns the outcome transaction (row lock, state
 * rules, closing note, status write, status-saved event). This service owns
 * what storage must not know — which eligibility checks exist and are
 * enabled, whether the exemptions component is on, how a grant describes
 * itself — and hands the storage a grant callback that runs INSIDE its
 * transaction, so the exemption and the close commit or roll back together.
 *
 * `grantOpenEndedExemption` is the one entry point for every process that
 * grants an exemption on someone's behalf (a bulk employer/benefit import
 * would call it with its own `source`); the grant itself is idempotent per
 * worker + benefit + check set, so repeating a request never duplicates.
 */
import {
  TRUST_EXEMPTION_SOURCE_BAO_APPEAL,
  type TrustBenefitEligibilityExemptionSource,
  type TrustBenefitEligibilityExemptionView,
} from "@shared/schema";
import { toYmd } from "@shared/utils/date";
import { storage } from "../../../storage";
import type {
  BaoAppealExemptionSubject,
  BaoAppealOutcomeResult,
  CreateBaoCaseInput,
} from "../../../storage/sitespecific/bao/cases";
import { getEnabledComponentIdsSync, isComponentEnabledSync } from "../../component-cache";
import { eligibilityPluginRegistry } from "../../../plugins/trust/eligibility/registry";

/** The optional component that owns the exemptions table. */
export const EXEMPTIONS_COMPONENT_ID = "trust.benefits.eligibility.exemptions";

/**
 * A refusal the case routes map to a response: `message` is the code (the
 * route's error table names the HTTP status and the human text), `details`
 * whatever names the offending input.
 */
export class AppealOutcomeError extends Error {
  constructor(code: string, public readonly details?: unknown) {
    super(code);
    this.name = "AppealOutcomeError";
  }
}

export interface OpenEndedExemptionGrant {
  subscriberWorkerId: string;
  benefitId: string;
  eligibilityPlugins: string[];
  /** First day the exemption applies (YYYY-MM-DD); it never ends. */
  startYmd: string;
  description: string | null;
  source: TrustBenefitEligibilityExemptionSource;
}

export interface OpenEndedExemptionGrantResult {
  exemption: TrustBenefitEligibilityExemptionView;
  /** False when an equivalent exemption already existed and was reused. */
  created: boolean;
}

export interface ExemptionCheckOption {
  id: string;
  name: string;
  description: string;
}

/**
 * The eligibility checks an approval may waive right now, for the staff
 * Approve dialog. The plugin manifest is admin-only, so the case screen asks
 * here instead. Empty (not an error) while the exemptions component is off;
 * the grant itself still refuses then.
 */
export function listExemptionChecks(): ExemptionCheckOption[] {
  if (!isComponentEnabledSync(EXEMPTIONS_COMPONENT_ID)) return [];
  return eligibilityPluginRegistry
    .getAllFiltered(getEnabledComponentIdsSync())
    .filter((p) => !p.metadata.hidden)
    .map((p) => ({ id: p.id, name: p.metadata.name, description: p.metadata.description }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The checks a grant may waive: the exemptions component must be on (its
 * table is optional), and every id must name a registered eligibility plugin
 * whose own component is enabled. Returns the ids deduplicated.
 */
export function validateExemptionChecks(ids: readonly string[]): string[] {
  if (!isComponentEnabledSync(EXEMPTIONS_COMPONENT_ID)) {
    throw new AppealOutcomeError("EXEMPTIONS_COMPONENT_DISABLED");
  }
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  if (unique.length === 0) throw new AppealOutcomeError("EXEMPTION_CHECKS_REQUIRED");
  const enabledComponents = getEnabledComponentIdsSync();
  const unknown = unique.filter((id) => !eligibilityPluginRegistry.isPluginEnabled(id, enabledComponents));
  if (unknown.length > 0) {
    throw new AppealOutcomeError("UNKNOWN_ELIGIBILITY_PLUGIN", { unknownPluginIds: unknown });
  }
  return unique;
}

/**
 * Grant a never-ending exemption on behalf of a process. Joins an open
 * transaction when called inside one. Idempotent: an existing open-ended
 * exemption for the same worker, benefit and check set that starts on or
 * before `startYmd` is reused (`created: false`) rather than duplicated.
 */
export async function grantOpenEndedExemption(
  input: OpenEndedExemptionGrant,
): Promise<OpenEndedExemptionGrantResult> {
  const eligibilityPlugins = validateExemptionChecks(input.eligibilityPlugins);
  return storage.trustBenefitEligibilityExemptions.grantOpenEnded({ ...input, eligibilityPlugins });
}

export interface ApproveAppealInput {
  actorUserId: string;
  eligibilityPlugins: string[];
  startYmd: string;
  resolutionId?: string;
  resolutionYmd?: string;
}

export interface DenyAppealInput {
  actorUserId: string;
  note?: CreateBaoCaseInput["initialNote"];
  resolutionId?: string;
  resolutionYmd?: string;
}

/** How the exemption an approval grants describes itself. */
function describeAppealGrant(subject: BaoAppealExemptionSubject): string {
  const benefit = subject.benefitName ?? "benefit";
  const opened = toYmd(subject.createdAt);
  return `Trustee-approved ${benefit} appeal${opened ? ` opened ${opened}` : ""} (case ${subject.caseId})`;
}

/**
 * Approve: grant the exemption and move the case to Approved in one
 * transaction. The checks are validated before the transaction opens (a bad
 * request never takes the row lock) and the grant targets the ROW-LOCKED
 * case's worker and benefit, never a client-supplied pair.
 */
export async function approveAppeal(caseId: string, input: ApproveAppealInput): Promise<BaoAppealOutcomeResult> {
  const eligibilityPlugins = validateExemptionChecks(input.eligibilityPlugins);
  return storage.baoCases.recordAppealOutcome(caseId, {
    outcome: "approved",
    actorUserId: input.actorUserId,
    resolutionId: input.resolutionId,
    resolutionYmd: input.resolutionYmd,
    grantExemption: async (subject) => {
      const source: TrustBenefitEligibilityExemptionSource = { kind: TRUST_EXEMPTION_SOURCE_BAO_APPEAL, caseId: subject.caseId };
      const { exemption, created } = await grantOpenEndedExemption({
        subscriberWorkerId: subject.subscriberWorkerId,
        benefitId: subject.benefitId,
        eligibilityPlugins,
        startYmd: input.startYmd,
        description: describeAppealGrant(subject),
        source,
      });
      return { exemptionId: exemption.id, created };
    },
  });
}

/** Deny: move the case to Closed–Denied, with the optional closing note. */
export async function denyAppeal(caseId: string, input: DenyAppealInput): Promise<BaoAppealOutcomeResult> {
  return storage.baoCases.recordAppealOutcome(caseId, {
    outcome: "denied",
    actorUserId: input.actorUserId,
    resolutionId: input.resolutionId,
    resolutionYmd: input.resolutionYmd,
    note: input.note,
  });
}
