import { sitespecificFreemanCrewleads } from "../shared/schema/sitespecific/freeman/schema";
import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";

export const metadataContexts: Record<string, MetadataRecordContext> = {
  sitespecific_freeman_crewleads: {
    component: "sitespecific.freeman",
    table: sitespecificFreemanCrewleads,
    label: "Freeman Crew Leads",
    hrefTemplate: null,
  },
};
