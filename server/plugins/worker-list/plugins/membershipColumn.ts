import { registerWorkerListPlugin } from "../registry";
import type { WorkerListPlugin } from "../types";

/**
 * Configures the Membership column on /workers:
 *
 * - `member-status` (default): the worker's member-status badge plus the
 *   last dues payment from the configured (or legacy btu-dues-allocation)
 *   account — today's behavior.
 * - `authorization`: whether the worker has a signed cardcheck of one of the
 *   configured definitions (i.e. has authorized employer contribution
 *   withholding), their current balance in the configured ledger account,
 *   and the last payment date.
 *
 * With no account selected, the balance/last-payment lookup falls back to
 * the account resolved from the enabled `btu-dues-allocation` charge plugin
 * config, so an unconfigured system matches BTU's current behavior exactly.
 */
export const MEMBERSHIP_COLUMN_PLUGIN_ID = "membership-column";

const membershipColumnPlugin: WorkerListPlugin = {
  metadata: {
    id: MEMBERSHIP_COLUMN_PLUGIN_ID,
    name: "Membership Column",
    description:
      "Controls what the Membership column on the worker list shows: the member-status view or the withholding-authorization view (signed cardcheck, account balance, last payment).",
    requiredComponent: "cardcheck",
    singleton: true,
  },
  configSchema: {
    type: "object",
    properties: {
      displayMode: {
        type: "string",
        title: "Display mode",
        description:
          "Member status shows the worker's member-status badge (current behavior). Authorization shows whether the worker has signed a configured cardcheck, their account balance, and last payment.",
        enum: ["member-status", "authorization"],
        enumNames: ["Member status", "Authorization"],
        default: "member-status",
      },
      accountId: {
        type: "string",
        title: "Ledger account",
        description:
          "Account used for the balance and last-payment lookups. Leave unset to fall back to the BTU dues allocation account.",
        "x-options-endpoint": "/api/ledger/accounts",
      },
      cardcheckDefinitionIds: {
        type: "array",
        title: "Authorization cardcheck definitions",
        description:
          "Signed cardchecks of these types count as a withholding authorization. Leave empty to count any signed cardcheck.",
        items: { type: "string" },
        uniqueItems: true,
        "x-options-endpoint": "/api/cardcheck/definitions",
      },
    },
  },
};

registerWorkerListPlugin(membershipColumnPlugin);
