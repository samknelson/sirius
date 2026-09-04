import { sitespecificBaoAppealDetails } from "../../../../shared/schema/sitespecific/bao/schema";
import { registerTokenPlugin } from "../registry";

/**
 * Token descriptor for a BAO benefit appeal — the `sitespecific_bao_appeal_details`
 * row behind an appeal case — used by the member-facing case notifier:
 * `{{sitespecific_bao_appeal.field(name="benefit_name")}}`,
 * `…field(name="denial_reason_name")`, `…field(name="spd_citation")`.
 *
 * The three extras are the letter-facing values of RELATED records read
 * together with the row (benefit off the case, reason name and SPD citation
 * off the denial reason, the citation overridable per appeal), so a letter
 * quotes the appeal it is about. Gated on the BAO component.
 */
const COMPONENT = "sitespecific.bao";
export const BAO_APPEAL_ENTITY_KIND = "sitespecific_bao_appeal";

/**
 * Named sample appeals, one per shared persona id. Obviously fictional: a
 * preview must never be mistaken for a real appeal.
 */
const BAO_APPEAL_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      id: "SAMPLE-BAO-APPEAL-001",
      case_id: "SAMPLE-BAO-CASE-001",
      benefit_name: "Olympus Mons Medical Plan",
      denial_reason_name: "Insufficient hours in the eligibility period",
      spd_citation: "Summary Plan Description, Article IV, Section 2 (Hours Requirement)",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      id: "SAMPLE-BAO-APPEAL-002",
      case_id: "SAMPLE-BAO-CASE-002",
      benefit_name: "Difference Engine Dental Plan",
      denial_reason_name: "Coverage lapsed before the date of service",
      spd_citation: "Summary Plan Description, Article VI, Section 1 (Termination of Coverage)",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      id: "SAMPLE-BAO-APPEAL-003",
      case_id: "SAMPLE-BAO-CASE-003",
      benefit_name: "Golden Fleece Vision Plan",
      denial_reason_name: "Service not covered under the plan",
      spd_citation: "Summary Plan Description, Article VIII (Exclusions)",
    },
  },
];

/**
 * Entity descriptor: never matches as a segment (`inputTypes: []`) — it
 * exists so the field catalog derives the appeal kind's valid
 * `field(name=…)` names from the live Drizzle schema plus the three extras
 * every surface building this kind carries (the notifier and the preview
 * loader both read them through `storage.baoCases.getAppeal`).
 */
registerTokenPlugin({
  metadata: {
    id: "token.sitespecific_bao_appeal",
    name: "BAO benefit appeal",
    description: "Descriptor for the BAO benefit appeal entity kind",
    segmentName: "__sitespecific_bao_appeal",
    inputTypes: [],
    outputType: BAO_APPEAL_ENTITY_KIND,
    entityTable: sitespecificBaoAppealDetails,
    entityFields: ["benefit_name", "denial_reason_name", "spd_citation"],
    // `{{sitespecific_bao_appeal}}` on its own names the benefit appealed —
    // the one fact a member reading a letter about it needs first.
    defaultLeaf: "benefit_name",
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: BAO_APPEAL_SAMPLE_SETS,
    // An appeal has no page of its own: it is read on its case's detail page.
    entityLocation: {
      tabEntity: "bao_case",
      idField: "caseId",
      defaultTab: "details",
    },
    // Case detail is gated `staff` plus the BAO component, with no per-case
    // policy; the appeal behind a case is read under that same gate.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        const appeal = await storage.baoCases.getAppeal({ id });
        if (!appeal) return null;
        return {
          entity: {
            kind: BAO_APPEAL_ENTITY_KIND,
            row: appeal as unknown as Record<string, unknown>,
            table: sitespecificBaoAppealDetails,
          },
          label: `${appeal.benefitName ?? "Benefit appeal"} — ${appeal.denialReasonName ?? "no denial reason"}`,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});
