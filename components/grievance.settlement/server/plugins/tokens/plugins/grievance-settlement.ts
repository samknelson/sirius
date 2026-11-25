import { grievanceSettlements } from "../../../../shared/schema/grievance/settlement-schema";
import { grievances } from "../../../../../grievance/shared/schema/grievance/schema";
import {
  composeGrievanceDisplayTitle,
  GRIEVANCE_ENTITY_KIND,
  loadGrievanceEntity,
} from "../../../../../grievance/server/plugins/tokens/plugins/grievance";
import { registerTokenPlugin } from "../../../../../../server/plugins/tokens/registry";
import { tokenEntityOf } from "../../../../../../server/plugins/tokens/types";

/**
 * Token plugins for the grievance settlement entity kind, used by the
 * settlement notifier: one settlement row, with the event's `operation`
 * (created/updated/deleted) merged onto it by the notifier.
 */
export const GRIEVANCE_SETTLEMENT_ENTITY_KIND = "grievance_settlement";

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
    hiddenFromPicker: true,
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

/** {{event.grievance.field(name="…")}} — the settlement's grievance. */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_settlement_relation.grievance",
    name: "Grievance",
    description: "The grievance this settlement belongs to",
    segmentName: "grievance",
    inputTypes: [GRIEVANCE_SETTLEMENT_ENTITY_KIND],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    hiddenFromPicker: true,
    requiredComponent: "grievance.settlement",
  },
  async resolve(entity, _args, ctx) {
    const grievanceId = tokenEntityOf(entity, GRIEVANCE_SETTLEMENT_ENTITY_KIND)?.row.grievanceId;
    if (typeof grievanceId !== "string") return null;
    return loadGrievanceEntity(ctx, grievanceId);
  },
});
