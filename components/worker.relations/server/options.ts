import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsWorkerRelationType } from "../shared/schema/worker/relations/schema";
declare module "../../../server/storage/unified-options" { interface OptionsTypeNames { "worker-relation-type": true } }
registerOptionsContribution({ id: "worker.relations.options", type: "worker-relation-type", definition: {
  table: optionsWorkerRelationType, displayName: "Worker Relationship Type",
  description: "Manage relationship types used between workers (e.g. spouse, parent, sibling).",
  singularName: "Worker Relationship Type", pluralName: "Worker Relationship Types", orderByColumn: "name",
  loggingModule: "options.workerRelationType", requiredFields: ["name"], optionalFields: ["siriusId", "description", "data"],
  requiredComponent: "worker.relations", supportsSequencing: false,
  fields: [
    { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Spouse, Parent, Sibling", showInTable: true, columnHeader: "Name" },
    { name: "icon", label: "Icon", inputType: "icon", required: false, placeholder: "Select an icon", showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
    { name: "description", label: "Description", inputType: "text", required: false, placeholder: "Short description of this relationship type", showInTable: true, columnHeader: "Description" },
    { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
  ],
} });
