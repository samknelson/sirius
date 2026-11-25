import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import {
  grievanceComplaints,
  grievanceEmployers,
  grievanceRemedies,
  grievanceTimelineTemplateSteps,
  grievanceTimelineTemplates,
  grievanceUsers,
  grievanceWorkers,
  grievances,
} from "../shared/schema/grievance/schema";

export const metadataContexts: Record<string, MetadataRecordContext> = {
  grievance_complaints: { table: grievanceComplaints, label: "Grievance Complaints", hrefTemplate: null },
  grievance_employers: { table: grievanceEmployers, label: "Grievance Employers", hrefTemplate: null },
  grievance_remedies: { table: grievanceRemedies, label: "Grievance Remedies", hrefTemplate: null },
  grievance_timeline_template_steps: { table: grievanceTimelineTemplateSteps, label: "Grievance Timeline Template Steps", hrefTemplate: null },
  grievance_timeline_templates: {
    table: grievanceTimelineTemplates,
    label: "Grievance Timeline Templates",
    hrefTemplate: "/grievance-timeline-template/{id}",
    recordGo: { kind: "policy", id: "staff", componentId: "grievance" },
  },
  grievance_users: { table: grievanceUsers, label: "Grievance Staff", hrefTemplate: null },
  grievance_workers: { table: grievanceWorkers, label: "Grievance Workers", hrefTemplate: null },
  grievances: {
    table: grievances,
    label: "Grievances",
    hrefTemplate: "/grievance/{id}",
    entityTypes: ["grievance"],
    recordGo: { kind: "policy", id: "staff", componentId: "grievance" },
  },
};

/** Tables that must not receive record-history metadata, as in server/storage/system/entity-metadata-policy.ts. */
export const excludedTables = ["grievance_status_history"] as const;
