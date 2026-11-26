import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsWorkerBadgeTypes, insertOptionsWorkerBadgeTypeSchema } from "../shared/schema/worker/badges/schema";
declare module "../../../server/storage/unified-options" { interface OptionsTypeNames { "worker-badge-type": true } }
registerOptionsContribution({ id: "worker.badges.options", type: "worker-badge-type", definition: {
  table: optionsWorkerBadgeTypes, displayName: "Worker Badge Type",
  description: "Manage badge types awarded through system activity",
  singularName: "Worker Badge Type", pluralName: "Worker Badge Types", orderByColumn: "name",
  loggingModule: "options.workerBadgeTypes", requiredFields: ["name"], optionalFields: ["icon", "siriusId", "description", "data"],
  requiredComponent: "worker.badges", supportsSequencing: false, writeSchema: insertOptionsWorkerBadgeTypeSchema,
  fields: [
    { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px" },
    { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Badge type name", showInTable: true, columnHeader: "Name" },
    { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "Optional external ID", showInTable: true, columnHeader: "Sirius ID" },
    { name: "description", label: "Description", inputType: "textarea", required: false, showInTable: true, columnHeader: "Description" },
  ],
} });
