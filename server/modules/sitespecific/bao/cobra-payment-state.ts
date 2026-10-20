import { storage } from "../../../storage/database";
import {
  toChargeConfig,
} from "../../../plugins/ledger/charge/charge-config-resolution";
import {
  type CobraPaymentState,
} from "@shared/schema/sitespecific/bao/cobra";
import { decideCobraLifecycle, type CobraLifecycleDecision } from "@shared/schema/sitespecific/bao/cobra-lifecycle";
import type { BaoCobraCase } from "@shared/schema/sitespecific/bao/schema";

export const COBRA_CHARGE_PLUGIN_ID = "sitespecific-bao-cobra";

/**
 * Resolve the ledger account COBRA premiums are billed to: the account on the
 * enabled global config of the COBRA charge plugin. Multiple accounts are
 * ambiguous: never guess which financial history controls a case.
 */
export async function resolveCobraAccountId(): Promise<string | null> {
  const configs = (
    await storage.pluginConfigs.search("charge", {
      pluginId: COBRA_CHARGE_PLUGIN_ID,
      enabled: true,
      scope: "global",
    })
  ).map(toChargeConfig);
  const accounts = new Set(configs.map((c) => c.account).filter(Boolean));
  if (accounts.size > 1) throw new Error("Ambiguous COBRA billing accounts: multiple enabled global accounts");
  return [...accounts][0] ?? null;
}

export interface CobraPaymentStateResult {
  state: CobraPaymentState;
  /** Signed balance on the COBRA account (positive = owed). */
  balance: string;
  accountId: string;
}

export async function evaluateCobraCasePayment(
  theCase: BaoCobraCase,
  todayYmd: string,
  accountId: string,
): Promise<CobraLifecycleDecision & { balance: string }> {
  const elections = (await storage.workerTrustElections.listByWorker(theCase.coveredPersonWorkerId))
    .filter((e) => e.enrollmentType === "cobra" &&
      (e.data as { cobraCaseId?: string } | null)?.cobraCaseId === theCase.id);
  if (elections.length !== 1 || !elections[0].benefitIds?.length) {
    return { blockers: ["Exactly one matching COBRA election with benefits is required"], balance: "0.00" };
  }
  const election = elections[0];
  const endYm = [todayYmd, theCase.maxPeriodYmd, election.endYmd]
    .filter((v): v is string => Boolean(v)).sort()[0].slice(0, 7);
  const startYm = theCase.cobraEffectiveYmd.slice(0, 7);
  const months = (await storage.ledger.entries.getCobraLifecycleEvidence(
    theCase.coveredPersonWorkerId, accountId, theCase.id,
  )).filter((m) => m.ym >= startYm && m.ym <= endYm);
  const decision = decideCobraLifecycle({
    electedYmd: theCase.electionMadeYmd,
    effectiveYmd: theCase.cobraEffectiveYmd,
    initialDeadlineYmd: theCase.initialPaymentDeadlineYmd,
    maxPeriodYmd: theCase.maxPeriodYmd,
    todayYmd,
    currentClosed: false,
    months,
  });
  // This is case obligation remaining, NOT the entire worker/account balance.
  const owed = months.reduce((sum, m) => sum + Math.max(0, m.caseChargeCents - m.paymentCents), 0);
  return { ...decision, balance: (owed / 100).toFixed(2) };
}

/** Read-only explanation for both staff and worker surfaces. */
export async function getCobraPaymentDiagnostics(theCase: BaoCobraCase) {
  if (!theCase.electionMadeYmd) return { blockers: [] as string[], balance: null };
  try {
    const accountId = await resolveCobraAccountId();
    if (!accountId) return { blockers: ["No COBRA billing account configured"], balance: null };
    const evaluated = await evaluateCobraCasePayment(theCase, todayYmdLocal(), accountId);
    return { blockers: evaluated.blockers, balance: evaluated.blockers.length ? null : evaluated.balance };
  } catch (error) {
    return { blockers: [error instanceof Error ? error.message : String(error)], balance: null };
  }
}

/**
 * Compute the payment state (paid / grace / delinquent) of a COBRA case from
 * case-attributed monthly obligations and cleared posted allocations.
 * Missing evidence is unknown, never a paid zero-balance account.
 */
export async function computeCobraCasePaymentState(
  theCase: BaoCobraCase,
  todayYmd: string,
  accountId?: string | null,
): Promise<CobraPaymentStateResult | null> {
  const account = accountId ?? (await resolveCobraAccountId());
  if (!account) return null;

  const result = await evaluateCobraCasePayment(theCase, todayYmd, account);
  if (result.blockers.length || !result.paymentStatus) return null;
  return { state: result.paymentStatus, balance: result.balance, accountId: account };
}

export function todayYmdLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
