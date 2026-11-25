import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { dispatchJobFore } from "../shared/schema/dispatch/fore-schema";
export const metadataContexts: Record<string, MetadataRecordContext> = {
  dispatch_job_fore: { table: dispatchJobFore, label: "Dispatch Job Foremen", hrefTemplate: null },
};
