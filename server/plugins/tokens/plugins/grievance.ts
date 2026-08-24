import {
  grievances,
  grievanceStatusHistory,
} from "../../../../shared/schema/grievance/schema";
import { grievanceSettlements } from "../../../../shared/schema/grievance/settlement-schema";
import { registerTokenPlugin } from "../registry";
import {
  memo,
  tokenEntityOf,
  type TokenEntity,
  type TokenEvalContext,
} from "../types";

/**
 * Token plugins for the grievance entity kinds, used by the
 * token-templated grievance notifiers:
 *   - `grievance` — a grievance row (loaded with its denorm `name`).
 *   - `grievance_status_history` — one status-history entry; its
 *     `status_id` FK auto-renders the status option's name.
 *   - `grievance_settlement` — one settlement row; the notifier merges
 *     the event's `operation` (created/updated/deleted) onto the row.
 * All broadly reusable: any surface that renders with one of these
 * entity kinds gets the full field catalog for free.
 */
export const GRIEVANCE_ENTITY_KIND = "grievance";
export const GRIEVANCE_STATUS_HISTORY_ENTITY_KIND = "grievance_status_history";
export const GRIEVANCE_SETTLEMENT_ENTITY_KIND = "grievance_settlement";

const COMPONENT = "grievance";

/**
 * The grievance's display title, mirroring the client's `grievanceTitle`
 * (and the pre-token notifier wording): denorm name, else
 * "<Category> Grievance", else "Grievance <id-prefix>".
 */
export function composeGrievanceDisplayTitle(
  grievanceId: string,
  info: { name: string | null; categoryName: string | null } | undefined,
): string {
  if (info?.name && info.name.trim()) return info.name;
  if (info?.categoryName) return `${info.categoryName} Grievance`;
  return `Grievance ${grievanceId.slice(0, 8)}`;
}

/**
 * Build a grievance row (with its denorm display name) as a token entity,
 * straight off storage. Separate from {@link loadGrievanceEntity} so a surface
 * that seeds the grievance as a ROOT — an event notifier, which has no token
 * eval context when it builds its records — reaches the same shape.
 *
 * The row carries every column of `grievances` plus the two derived extras the
 * descriptor advertises (`name` from the denorm read, `display_title` here), so
 * every field the editor offers on this kind actually resolves.
 */
export async function buildGrievanceEntity(
  storage: TokenEvalContext["storage"],
  grievanceId: string,
): Promise<TokenEntity | null> {
  const [base, info] = await Promise.all([
    storage.grievances.get(grievanceId),
    storage.grievances.getAssignmentTitleInfo(grievanceId),
  ]);
  if (!base) return null;
  return composeGrievanceEntity(base, info);
}

/**
 * The same shape from a grievance row already in hand — a surface that
 * captured the grievance when its event fired renders that snapshot instead
 * of re-reading a row that may since have been renamed or deleted.
 */
export function composeGrievanceEntity(
  row: { id: string },
  info: { name: string | null; categoryName: string | null } | undefined,
): TokenEntity {
  const base = row as unknown as Record<string, unknown>;
  return {
    kind: GRIEVANCE_ENTITY_KIND,
    row: {
      ...base,
      // `name` is denormalised, not a column: a caller holding a raw
      // `grievances` row has the title parts but not the name itself.
      name: info?.name ?? base.name ?? null,
      displayTitle: composeGrievanceDisplayTitle(row.id, info),
    },
    table: grievances,
  };
}

/**
 * Load a grievance row (with its denorm display name) as a token entity.
 * `display_title` is a derived extra carrying the client's full title
 * fallback chain so templates never render a blank/generic title.
 */
export async function loadGrievanceEntity(
  ctx: TokenEvalContext,
  grievanceId: string,
): Promise<TokenEntity | null> {
  return memo(ctx, `grievance-entity:${grievanceId}`, () =>
    buildGrievanceEntity(ctx.storage, grievanceId),
  );
}

/**
 * Named sample grievances, one per shared persona id. Values are obviously
 * fictional: a preview must never be mistaken for a real member's grievance.
 */
const GRIEVANCE_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      // `id` is named so the default templates' record links differ per
      // persona instead of all rendering the same placeholder.
      id: "SAMPLE-GRIEVANCE-001",
      sirius_id: "SAMPLE-G001",
      name: "Mars Colony Safety Violation",
      display_title: "Mars Colony Safety Violation",
      class_description: "Violation of Article 12, Section 4 — Safe Working Conditions",
      cardinality: "individual",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      id: "SAMPLE-GRIEVANCE-002",
      sirius_id: "SAMPLE-G002",
      name: "Analytical Engine Working Hours",
      display_title: "Analytical Engine Working Hours",
      class_description: "Violation of Article 8, Section 2 — Hours of Work",
      cardinality: "individual",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      id: "SAMPLE-GRIEVANCE-003",
      sirius_id: "SAMPLE-G003",
      name: "Navigation Duty Assignment",
      display_title: "Navigation Duty Assignment",
      class_description: "Violation of Article 15, Section 1 — Fair Work Assignment",
      cardinality: "group",
    },
  },
];

/**
 * Sample status entries. Keyed by the entry's OWN columns only — the
 * grievance's title is not one of them: a template reaches it through the
 * entry's `grievance` relation (or the notifier's own `grievance` root),
 * which renders from the grievance persona of the same name.
 *
 * `status_id` is the status FK, which renders as the status option's name.
 */
const GRIEVANCE_STATUS_HISTORY_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      id: "SAMPLE-GRIEVANCE-STATUS-001",
      status_id: "Filed",
      date: "2031-03-04",
      is_current: "Yes",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      id: "SAMPLE-GRIEVANCE-STATUS-002",
      status_id: "Arbitration",
      date: "1843-11-20",
      is_current: "Yes",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      id: "SAMPLE-GRIEVANCE-STATUS-003",
      status_id: "Withdrawn",
      date: "1200-06-15",
      is_current: "Yes",
    },
  },
];

const GRIEVANCE_SETTLEMENT_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      operation: "created",
      description: "Retroactive pay and new safety protocols for Sector 7 haulers",
      amount: "4500.00",
      summary: "Settlement reached: back pay plus safety equipment upgrade",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      operation: "updated",
      description: "Revised access schedule and back pay for engine room operators",
      amount: "1200.00",
      summary: "Settlement amended: shortened shifts and schedule compensation",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      operation: "deleted",
      description: "Navigation provisions dispute withdrawn after voyage reassignment",
      amount: "750.00",
      summary: "Settlement voided: grievant accepted alternate posting",
    },
  },
];

/**
 * Grievance descriptor: never matches as a segment (`inputTypes: []`) —
 * exists so the field catalog derives valid `field(name=…)` names from
 * the live schema. `name` is the denorm display name the storage read
 * attaches to the row (not a table column).
 */
registerTokenPlugin({
  metadata: {
    id: "token.grievance",
    name: "Grievance",
    description: "Descriptor for the grievance entity kind",
    segmentName: "__grievance",
    inputTypes: [],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    // `{{grievance}}` on its own means the grievance's display title —
    // the one thing a template naming a grievance almost always wants.
    // Declared here (the plugin that OWNS the kind), so every way of
    // arriving at a grievance — the notifiers' seeded root, the relation
    // below — ends the same way.
    defaultLeaf: "display_title",
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: GRIEVANCE_SAMPLE_SETS,
    // A grievance has its own page, so `{{grievance.path}}` and
    // `{{grievance.url}}` link to it — and the `tab` argument reaches
    // its sub-pages without an author having to remember that the
    // detail route is /grievance/:id and not /grievances/:id.
    entityLocation: {
      tabEntity: "grievance",
      idField: "id",
      defaultTab: "details",
    },
    // Grievance pages have no per-grievance policy: every read is gated
    // `staff` plus the grievance component, with no id passed. Preview
    // enforces exactly that gate.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        // The SAME builder the notifiers seed their `grievance` root
        // with, so the preview row carries exactly the denorm `name` and
        // `display_title` delivery renders.
        const entity = await buildGrievanceEntity(storage, id);
        if (!entity) return null;
        return { entity, label: String(entity.row.displayTitle) };
      },
    },
  },
  async resolve(entity, _args, ctx) {
    const e =
      tokenEntityOf(entity, GRIEVANCE_STATUS_HISTORY_ENTITY_KIND) ??
      tokenEntityOf(entity, GRIEVANCE_SETTLEMENT_ENTITY_KIND);
    const grievanceId = e?.row.grievanceId;
    if (typeof grievanceId !== "string") return null;
    return loadGrievanceEntity(ctx, grievanceId);
  },
});

/**
 * Status-history entry descriptor. The kind offers its OWN columns and
 * nothing else: `status_id` renders the status option's name through the
 * FK, and the grievance's title is reached through the `grievance`
 * relation below. There are deliberately no flattened extras — an extra
 * named after a related record's value ("grievance_title") reads like a
 * column of this table, and only resolves when whoever seeded the record
 * remembered to merge it.
 */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_status_history",
    name: "Grievance status entry",
    description: "Descriptor for the grievance status-history entity kind",
    segmentName: "__grievance_status_history",
    inputTypes: [],
    outputType: GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
    entityTable: grievanceStatusHistory,
    // `{{grievance_status}}` on its own means the status's name — a human
    // naming a status entry says the status ("Filed", "Arbitration"), and
    // the FK column renders the referenced option's name.
    defaultLeaf: "status_id",
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: GRIEVANCE_STATUS_HISTORY_SAMPLE_SETS,
    // An entry has no page of its own; the grievance's timeline is where
    // it is listed, and the row can reach that grievance's id. Same
    // declaration as a top-level kind — a sub-entity is just a location
    // whose id comes from a foreign key.
    entityLocation: {
      tabEntity: "grievance",
      idField: "grievanceId",
      defaultTab: "timeline",
    },
    // An entry is read wherever its grievance is read: `staff` plus the
    // grievance component, no per-record policy.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        // The row exactly as the status notifier's root builder loads it —
        // no derived extras: the kind advertises none.
        const row = await storage.grievanceStatusHistory.getById(id);
        if (!row) return null;
        const info = await storage.grievances.getAssignmentTitleInfo(
          row.grievanceId,
        );
        return {
          entity: {
            kind: GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
            row: row as unknown as Record<string, unknown>,
            table: grievanceStatusHistory,
          },
          label: composeGrievanceDisplayTitle(row.grievanceId, info),
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});

/**
 * Settlement descriptor. `operation` is a derived extra: the settlement
 * notifier merges the event's operation (created/updated/deleted) onto
 * the row, so templates can say `was {{event.field(name="operation")}}`.
 */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_settlement",
    name: "Grievance settlement",
    description: "Descriptor for the grievance settlement entity kind",
    segmentName: "__grievance_settlement",
    inputTypes: [],
    outputType: GRIEVANCE_SETTLEMENT_ENTITY_KIND,
    entityTable: grievanceSettlements,
    // Derived extras, not columns: the event's operation and the whole
    // legacy per-operation sentence built from it. Nothing about the
    // grievance — that is its own record, reached through the relation
    // below (or the grievance root the settlement notifier seeds).
    entityFields: ["operation", "summary"],
    // `{{settlement}}` on its own means the settlement's description —
    // the phrase a human uses to say WHICH settlement this is (the picker
    // hint shows the same thing). `summary` is a whole sentence about an
    // operation, not a name.
    defaultLeaf: "description",
    hiddenFromCatalog: true,
    requiredComponent: "grievance.settlement",
    sampleSets: GRIEVANCE_SETTLEMENT_SAMPLE_SETS,
    // No page of its own: the grievance's settlements tab is where a
    // settlement is listed, reached through the row's grievance FK.
    entityLocation: {
      tabEntity: "grievance",
      idField: "grievanceId",
      defaultTab: "settlements",
    },
    // A settlement is read wherever its grievance is read: `staff` plus
    // the settlement component, no per-record policy.
    previewEntity: {
      gate: { scope: "route", policy: "staff" },
      async load(storage, id) {
        // The notifier owns the derived wording (`summary`); the settlement
        // exists, so the event it stands for is the one that created it —
        // the same wording the picker shows for a standing record.
        const [{ settlementSummary }, row] = await Promise.all([
          import("../../event-notifier/plugins/grievance-settlement-notifier"),
          storage.grievanceSettlements.getById(id),
        ]);
        if (!row) return null;
        const info = await storage.grievances.getAssignmentTitleInfo(
          row.grievanceId,
        );
        const grievanceTitle = composeGrievanceDisplayTitle(
          row.grievanceId,
          info,
        );
        return {
          entity: {
            kind: GRIEVANCE_SETTLEMENT_ENTITY_KIND,
            row: {
              ...(row as unknown as Record<string, unknown>),
              operation: "created",
              // The title appears in the LABEL (so an author can tell the
              // entries apart) and inside the legacy summary sentence, but
              // never as a field of the settlement itself.
              summary: settlementSummary("created", grievanceTitle, row.amount),
            },
            table: grievanceSettlements,
          },
          label: grievanceTitle,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});

/** {{event.grievance.field(name="…")}} — the entry's/settlement's grievance. */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_relation.grievance",
    name: "Grievance",
    description: "The grievance this record belongs to",
    segmentName: "grievance",
    inputTypes: [
      GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
      GRIEVANCE_SETTLEMENT_ENTITY_KIND,
    ],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e =
      tokenEntityOf(entity, GRIEVANCE_STATUS_HISTORY_ENTITY_KIND) ??
      tokenEntityOf(entity, GRIEVANCE_SETTLEMENT_ENTITY_KIND);
    const grievanceId = e?.row.grievanceId;
    if (typeof grievanceId !== "string") return null;
    return loadGrievanceEntity(ctx, grievanceId);
  },
});
