import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsCertifications } from "../shared/schema/worker/certifications/schema";
declare module "../../../server/storage/unified-options" { interface OptionsTypeNames { certification: true } }
registerOptionsContribution({ id: "worker.certifications.options", type: "certification", definition: {
  table: optionsCertifications, displayName: "Worker Certification",
  description: "Manage certification types that can be assigned to workers",
  singularName: "Worker Certification", pluralName: "Worker Certifications", orderByColumn: "name",
  loggingModule: "options.certifications", requiredFields: ["name"], optionalFields: ["siriusId", "data"],
  supportsSequencing: false, requiredComponent: "worker.certifications",
  fields: [
    { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Certification name", showInTable: true, columnHeader: "Name" },
    { name: "icon", label: "Icon", inputType: "icon", required: false, placeholder: "Select an icon", showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
    { name: "skills", label: "Auto-Grant Skills", inputType: "select-options", required: false, helperText: "Skills to automatically grant when this certification is active", showInTable: false, selectOptionsType: "skill", dataField: true },
    { name: "defaultDuration", label: "Default Duration (months)", inputType: "number", required: false, placeholder: "e.g., 12", helperText: "Default validity period in months", showInTable: true, columnHeader: "Duration", dataField: true },
    { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
  ],
} });
