import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { sitespecificT631JobInterviews } from "../shared/schema/sitespecific/t631/interviews-schema";
export const metadataContexts: Record<string, MetadataRecordContext> = {
  sitespecific_t631_job_interviews: {
    component: "sitespecific.t631.interviews",
    table: sitespecificT631JobInterviews,
    label: "T631 Job Interviews",
    hrefTemplate: null,
  },
};
