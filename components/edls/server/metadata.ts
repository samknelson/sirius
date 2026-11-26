import type { MetadataRecordContext } from "../../../server/storage/entity-metadata-record-tables";
import { edlsAssignments, edlsCrews, edlsSheets, workerEdls } from "../shared/schema/edls/schema";

export const metadataContexts: Record<string, MetadataRecordContext> = {
  edls_assignments: { table: edlsAssignments, label: "EDLS Assignments", hrefTemplate: null },
  edls_crews: { table: edlsCrews, label: "EDLS Crews", hrefTemplate: null },
  edls_sheets: {
    table: edlsSheets,
    label: "EDLS Sheets",
    hrefTemplate: "/edls/sheet/{id}",
    entityTypes: ["edls_sheet"],
    recordGo: { kind: "policy", id: "edls.sheet.view", componentId: "edls" },
  },
  worker_edls: { table: workerEdls, label: "Worker EDLS Settings", hrefTemplate: null },
};
