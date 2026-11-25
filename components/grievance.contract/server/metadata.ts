import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { grievanceContracts } from "../shared/schema/grievance/contract-schema";

export const metadataContexts: Record<string, MetadataRecordContext> = {
  grievance_contracts: { table: grievanceContracts, label: "Grievance Contract Citations", hrefTemplate: null },
};
