import {
  sitespecificBaoCases,
  type BaoCase,
  type BaoCaseAppealFacts,
} from "../../../../shared/schema/sitespecific/bao/schema";
import { registerTokenPlugin } from "../registry";
import type { TokenEntity, TokenSampleSet } from "../types";

/**
 * Token descriptor for the generic BAO case entity kind, used by the
 * token-templated `bao_case_status` notifier:
 * `{{sitespecific_bao_case.field(name="deadline_ymd")}}`, the derived
 * `status_name` / `entity_name` extras, the Benefit Appeal facts
 * (`benefit_name`, `denial_reason_name`, `spd_citation`), and the case's
 * own `path`/`url` link leaves (the case detail page, via the shared tab
 * registry). Gated on the BAO component.
 */
const COMPONENT = "sitespecific.bao";
export const BAO_CASE_ENTITY_KIND = "sitespecific_bao_case";

/**
 * The event-time display names and appeal facts every surface building
 * this kind carries beside the case row. The notifier snapshots them in the
 * writing transaction; the preview loader reads them off the detail query —
 * both through the storage's one detail mapping, so a rendered letter says
 * what the case detail screen shows.
 */
export interface BaoCaseEntityNames extends BaoCaseAppealFacts {
  statusName: string;
  entityName: string | null;
  assigneeName: string | null;
}

/**
 * The ONE composition of a BAO case token entity. Delivery and preview both
 * go through here, so the row keys a template can reach are identical on
 * both: every advertised extra is present (null when it does not apply —
 * the appeal facts on a general case) rather than absent.
 */
export function composeBaoCaseEntity(
  row: BaoCase,
  names: BaoCaseEntityNames,
  changeSummary: string,
): TokenEntity {
  return {
    kind: BAO_CASE_ENTITY_KIND,
    row: {
      ...(row as unknown as Record<string, unknown>),
      statusName: names.statusName,
      entityName: names.entityName,
      assigneeName: names.assigneeName,
      benefitName: names.benefitName,
      denialReasonName: names.denialReasonName,
      spdCitation: names.spdCitation,
      changeSummary,
    },
    table: sitespecificBaoCases,
  };
}

/**
 * Named sample cases, one per shared persona id. Obviously fictional: a
 * preview must never be mistaken for a real case record. Only the worker
 * persona is a Benefit Appeal (appeals are worker cases), so it alone
 * names the appeal facts.
 */
const BAO_CASE_SAMPLE_SETS: TokenSampleSet[] = [
  {
    id: "martian",
    label: "Martian",
    values: {
      id: "SAMPLE-BAO-CASE-001",
      entity_type: "worker",
      entity_name: "Zephyr Colonist",
      status_name: "Auto Denied",
      deadline_ymd: "2031-03-04",
      assignee_name: "Astra Navigator",
      change_summary: "is now Auto Denied",
      benefit_name: "Olympus Mons Dental Plan",
      denial_reason_name: "Insufficient hours in the qualifying quarter",
      spd_citation: "Summary Plan Description, Article IV, Section 2(b) (Eligibility Hours)",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      id: "SAMPLE-BAO-CASE-002",
      entity_type: "employer",
      entity_name: "Analytical Engine Works",
      status_name: "In Progress",
      deadline_ymd: "1843-11-20",
      assignee_name: "Ada Lovelace",
      change_summary: "is now In Progress",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      id: "SAMPLE-BAO-CASE-003",
      entity_type: "trust_provider",
      entity_name: "Argonaut Provident Trust",
      status_name: "Closed",
      deadline_ymd: "1200-06-15",
      assignee_name: "Jason of Iolcus",
      change_summary: "is now Closed",
    },
  },
];

/**
 * Entity descriptor: never matches as a segment (`inputTypes: []`) — it
 * exists so the field catalog derives the case kind's valid
 * `field(name=…)` names from the live Drizzle schema. The extras are the
 * derived values every surface building this kind carries via
 * `composeBaoCaseEntity` (the notifier snapshots them event-time; the
 * preview loader reads them off the detail query).
 */
registerTokenPlugin({
  metadata: {
    id: "token.sitespecific_bao_case",
    name: "BAO case",
    description: "Descriptor for the generic BAO case entity kind",
    segmentName: "__sitespecific_bao_case",
    inputTypes: [],
    outputType: BAO_CASE_ENTITY_KIND,
    entityTable: sitespecificBaoCases,
    entityFields: [
      "status_name",
      "entity_name",
      "assignee_name",
      "change_summary",
      // Benefit Appeal facts; blank on a general case. `benefit_id` has no
      // declared FK, so the benefit's name cannot be reached through it.
      "benefit_name",
      "denial_reason_name",
      "spd_citation",
    ],
    // `{{sitespecific_bao_case}}` on its own means who the case is about —
    // the one fact that identifies a case to a staff reader.
    defaultLeaf: "entity_name",
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: BAO_CASE_SAMPLE_SETS,
    // The case's own detail page, declared once via the shared tab registry.
    entityLocation: {
      tabEntity: "bao_case",
      idField: "id",
      defaultTab: "details",
    },
    // BAO case detail is gated `staff` plus the BAO component, with no
    // per-case policy. Preview enforces that same route gate.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        const detail = await storage.baoCases.get(id);
        if (!detail) return null;
        const {
          notes: _notes,
          entityName,
          assigneeName,
          statusName,
          statusClosed: _statusClosed,
          caseTypeName: _caseTypeName,
          workflowStep: _workflowStep,
          resolutionName: _resolutionName,
          benefitName,
          denialReasonName,
          spdCitation,
          ...row
        } = detail;
        return {
          entity: composeBaoCaseEntity(
            row,
            { statusName, entityName, assigneeName, benefitName, denialReasonName, spdCitation },
            // Preview has no event to summarize; describe the current state
            // the same way a status-entry notification would.
            `is now ${statusName}`,
          ),
          label: `${entityName ?? detail.entityId} (${statusName})`,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});
