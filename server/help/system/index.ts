import type { Help } from "@shared/schema";
import { sanitizeHtml } from "@shared/utils/html";
import { likePatternMatches } from "../path-match";
import { trustProvidersHelp } from "./trust-providers";
import { workerBenefitsSummaryHelp } from "./worker-benefits-summary";
import { adminUserPermissionsHelp } from "./admin-user-permissions";
import { emailMessageDefaultsHelp, postalMessageDefaultsHelp, composeMessageDefaultsHelp } from "./message-defaults";
import { workerCommsComplianceHelp } from "./worker-comms-compliance";
import { workerPaymentChooserHelp, onlineCheckoutHelp, onlinePaymentReceiptHelp } from "./online-checkout";
import { workerPaymentMethodsHelp } from "./worker-payment-methods";
import { baoCobraHelp } from "./bao-cobra";
import { benefitsWorkflowHelp } from "./benefits-workflows";
import { financeUploadHelp } from "./finance-uploads";
import { messagingConfigurationHelp } from "./messaging-configuration";
import { workerRecordHelp } from "./worker-records";
import { organizationRecordHelp } from "./organization-records";
import { conditionalDomainHelp } from "./conditional-domains";
import { importsPensionReportsHelp } from "./imports-pension-reports";
import { baoConfigurationHelp } from "./bao-configuration";
import { administrationHelp } from "./administration";
import { integrationsAppearanceHelp } from "./integrations-appearance";
import { additionalPluginKindHelp } from "./additional-plugin-kinds";
import { reportTypeHelp } from "./report-types";

/**
 * A "system" help entry ships as source code and is always present,
 * with no database row. IDs must be stable and prefixed with
 * `system:` so routes can recognize and protect them from mutation.
 * `paths` uses the same SQL-LIKE `%` wildcard semantics as DB entries.
 */
export interface SystemHelpEntry {
  id: `system:${string}`;
  paths: string[];
  summary: string;
  details?: string | null;
}

/** Shape returned to clients: a Help row plus a source discriminator. */
export type HelpWithSource = Help & { source: "system" | "config" };

const entries: SystemHelpEntry[] = [
  workerPaymentChooserHelp,
  onlineCheckoutHelp,
  onlinePaymentReceiptHelp,
  workerPaymentMethodsHelp,
  workerCommsComplianceHelp,
  trustProvidersHelp,
  workerBenefitsSummaryHelp,
  adminUserPermissionsHelp,
  emailMessageDefaultsHelp,
  postalMessageDefaultsHelp,
  composeMessageDefaultsHelp,
  baoCobraHelp,
  ...benefitsWorkflowHelp,
  ...financeUploadHelp,
  ...messagingConfigurationHelp,
  ...workerRecordHelp,
  ...organizationRecordHelp,
  ...conditionalDomainHelp,
  ...importsPensionReportsHelp,
  ...baoConfigurationHelp,
  ...administrationHelp,
  ...integrationsAppearanceHelp,
  ...additionalPluginKindHelp,
  ...reportTypeHelp,
];

function toHelp(entry: SystemHelpEntry): HelpWithSource {
  return {
    id: entry.id,
    paths: entry.paths,
    summary: entry.summary,
    details:
      typeof entry.details === "string"
        ? sanitizeHtml(entry.details, "rich-document")
        : null,
    data: null,
    source: "system",
  };
}

const registry = new Map<string, HelpWithSource>();
for (const entry of entries) {
  if (!entry.id.startsWith("system:")) {
    throw new Error(`System help entry id must start with "system:": ${entry.id}`);
  }
  if (registry.has(entry.id)) {
    throw new Error(`Duplicate system help entry id: ${entry.id}`);
  }
  registry.set(entry.id, toHelp(entry));
}

export function isSystemHelpId(id: string): boolean {
  return id.startsWith("system:");
}

export function getSystemHelp(id: string): HelpWithSource | undefined {
  return registry.get(id);
}

export function getAllSystemHelps(): HelpWithSource[] {
  return [...registry.values()].sort((a, b) => a.summary.localeCompare(b.summary));
}

export function findSystemHelpsForPath(path: string): HelpWithSource[] {
  return getAllSystemHelps().filter((help) =>
    help.paths.some((pattern) => likePatternMatches(pattern, path))
  );
}
