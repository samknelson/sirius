import { storage } from "../../../storage/database";
import {
  toChargeConfig,
  pickFirstByAccountOrder,
} from "../../../plugins/ledger/charge/charge-config-resolution";
import {
  computeCobraPaymentState,
  type CobraPaymentState,
} from "@shared/schema/sitespecific/bao/cobra";
import type { BaoCobraCase } from "@shared/schema/sitespecific/bao/schema";

export const COBRA_CHARGE_PLUGIN_ID = "sitespecific-bao-cobra";

/**
 * Resolve the ledger account COBRA premiums are billed to: the account on the
 * first enabled global config of the COBRA charge plugin (legacy
 * account-nulls-last/id ordering). Null when the plugin has no enabled global
 * config or the config has no account.
 */
export async function resolveCobraAccountId(): Promise<string | null> {
  const configs = (
    await storage.pluginConfigs.search("charge", {
      pluginId: COBRA_CHARGE_PLUGIN_ID,
      enabled: true,
      scope: "global",
    })
  ).map(toChargeConfig);
  const config = pickFirstByAccountOrder(configs);
  return config?.account ?? null;
}

export interface CobraPaymentStateResult {
  state: CobraPaymentState;
  /** Signed balance on the COBRA account (positive = owed). */
  balance: string;
  accountId: string;
}

/**
 * Compute the payment state (paid / grace / delinquent) of a COBRA case from
 * the covered person's balance on the COBRA ledger account. Returns null when
 * no COBRA billing account is configured — callers must treat that as
 * "payment state unknown" and leave payment-driven behavior alone.
 */
export async function computeCobraCasePaymentState(
  theCase: BaoCobraCase,
  todayYmd: string,
  accountId?: string | null,
): Promise<CobraPaymentStateResult | null> {
  const account = accountId ?? (await resolveCobraAccountId());
  if (!account) return null;

  const balances = await storage.ledger.entries.getBalancesByEntityAndAccount(
    "worker",
    [theCase.coveredPersonWorkerId],
    [account],
  );
  const balance = balances[0]?.total ?? "0.00";
  const state = computeCobraPaymentState(
    balance,
    todayYmd,
    theCase.initialPaymentDeadlineYmd,
  );
  return { state, balance, accountId: account };
}

export function todayYmdLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
