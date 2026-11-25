import { registerComponentEvent } from "../../../server/services/event-bus";
import type { Grievance } from "../../grievance/shared/schema/grievance/schema";
import type { GrievanceSettlement } from "../shared/schema/grievance/settlement-schema";

export interface GrievanceSettlementSavedPayload {
  grievanceId: string;
  settlementId: string;
  operation: "created" | "updated" | "deleted";
  /**
   * The settlement row as of the event (the pre-delete row on delete).
   * Carried in full so a consumer can describe the settlement even for a
   * delete, where the row no longer exists by the time it runs.
   */
  row: GrievanceSettlement;
  /**
   * The grievance the settlement is on, as of the event, with the parts its
   * display title is composed from (both live outside the row: the name is
   * denormalised, the category name is a join). A settlement notice names
   * the grievance, so re-reading it at delivery time would let a later
   * rename change the wording — or a later deletion drop the notice.
   */
  grievance: Grievance | null;
  grievanceTitleParts: { name: string | null; categoryName: string | null } | null;
}

declare module "../../../server/services/event-bus" {
  interface ComponentEventPayloadMap {
    "grievance.settlement.saved": GrievanceSettlementSavedPayload;
  }
}

export const GRIEVANCE_SETTLEMENT_SAVED = registerComponentEvent("grievance.settlement.saved");
