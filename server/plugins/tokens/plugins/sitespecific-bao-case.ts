import { sitespecificBaoCases } from "../../../../shared/schema/sitespecific/bao/schema";
import { registerTokenPlugin } from "../registry";

/**
 * Token descriptor for the generic BAO case entity kind, used by the
 * token-templated `bao_case_status` notifier:
 * `{{sitespecific_bao_case.field(name="deadline_ymd")}}`, the derived
 * `status_name` / `entity_name` extras, and the case's own `path`/`url`
 * link leaves (the case detail page, via the shared tab registry).
 * Gated on the BAO component.
 */
const COMPONENT = "sitespecific.bao";
export const BAO_CASE_ENTITY_KIND = "sitespecific_bao_case";

/**
 * Named sample cases, one per shared persona id. Obviously fictional: a
 * preview must never be mistaken for a real case record.
 */
const BAO_CASE_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      id: "SAMPLE-BAO-CASE-001",
      entity_type: "worker",
      entity_name: "Zephyr Colonist",
      status_name: "Open",
      deadline_ymd: "2031-03-04",
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
    },
  },
];

/**
 * Entity descriptor: never matches as a segment (`inputTypes: []`) — it
 * exists so the field catalog derives the case kind's valid
 * `field(name=…)` names from the live Drizzle schema. `status_name` and
 * `entity_name` are derived extras every surface building this kind
 * carries (the notifier snapshots them event-time; the preview loader
 * reads them off the detail query).
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
    entityFields: ["status_name", "entity_name"],
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
        const { notes: _notes, ...row } = detail;
        return {
          entity: {
            kind: BAO_CASE_ENTITY_KIND,
            row: {
              ...(row as unknown as Record<string, unknown>),
              statusName: detail.statusName,
              entityName: detail.entityName,
            },
            table: sitespecificBaoCases,
          },
          label: `${detail.entityName ?? detail.entityId} (${detail.statusName})`,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});
