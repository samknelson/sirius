import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { grievanceSettlements } from "../shared/schema/grievance/settlement-schema";

export const metadataContexts: Record<string, MetadataRecordContext> = {
  grievance_settlements: { table: grievanceSettlements, label: "Grievance Settlements", hrefTemplate: null },
};
