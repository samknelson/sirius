export type AppealBenefit = "delta" | "healthnet" | "kaiser";
export interface AppealMapping { benefit: AppealBenefit; plugin: string }

export interface AppealOwnedRow {
  sourceKind: string | null;
  electionNid: number | null;
  workerId: string;
  benefitId: string;
  plugins: string[];
  startYmd: string;
  endYmd: string | null;
}

export interface DesiredAppealExemption {
  electionNid: number;
  workerId: string;
  benefitId: string;
  plugin: string;
  startYmd: string;
  endYmd: string | null;
}

export const APPEAL_CATALOG: Record<string, AppealMapping> = {
  eventcenterplandeltaappeal: { benefit: "delta", plugin: "sitespecific-bao-start-delta" },
  participationagreementdeltaappeal: { benefit: "delta", plugin: "sitespecific-bao-start-delta" },
  restaurantplandeltaappeal: { benefit: "delta", plugin: "sitespecific-bao-start-delta" },
  unitehereplandeltaappeal: { benefit: "delta", plugin: "sitespecific-bao-start-delta" },
  eventcenterplanhealthnetappeal: { benefit: "healthnet", plugin: "sitespecific-bao-start-healthnet" },
  unitehereplanhealthnetappeal: { benefit: "healthnet", plugin: "sitespecific-bao-start-healthnet" },
  eventcenterplankaiserappeal: { benefit: "kaiser", plugin: "sitespecific-bao-start-kaiser" },
  restaurantplankaiserappeal: { benefit: "kaiser", plugin: "sitespecific-bao-start-kaiser" },
  unitehereplankaiserappeal: { benefit: "kaiser", plugin: "sitespecific-bao-start-kaiser" },
};

/** Exact source names; aliases are limited to names evidenced by S1 fixtures. */
export const BENEFIT_NAME_CATALOG: Record<string, AppealBenefit> = {
  deltadental: "delta",
  healthnet: "healthnet",
  kaiser: "kaiser",
};
export const normalizeAppealName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");
export const appealForPolicyTitle = (title: string | null | undefined) =>
  title == null ? undefined : APPEAL_CATALOG[normalizeAppealName(title)];
export const benefitKindForExactName = (name: string | null | undefined) =>
  name == null ? undefined : BENEFIT_NAME_CATALOG[normalizeAppealName(name)];

/** Pure lifecycle classifier used by dry-run and unit coverage. */
export function classifyAppealExemption(
  rows: readonly AppealOwnedRow[],
  desired: DesiredAppealExemption,
): "create" | "update" | "unchanged" | "duplicate" {
  const owned = rows.filter(
    (row) => row.sourceKind === "s1_appeal_election" && row.electionNid === desired.electionNid,
  );
  if (owned.length > 1) return "duplicate";
  if (owned.length === 0) return "create";
  const row = owned[0];
  return row.workerId === desired.workerId
    && row.benefitId === desired.benefitId
    && row.plugins.length === 1
    && row.plugins[0] === desired.plugin
    && row.startYmd === desired.startYmd
    && row.endYmd === desired.endYmd
    ? "unchanged"
    : "update";
}

/** Only complete source evidence can authorize removal of vanished owned rows. */
export function deletedAppealElectionNids(
  ownedElectionNids: readonly number[],
  stagedElectionNids: ReadonlySet<number>,
  sourceComplete: boolean,
): number[] {
  if (!sourceComplete) return [];
  return [...new Set(ownedElectionNids)].filter((nid) => !stagedElectionNids.has(nid)).sort((a, b) => a - b);
}