import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsGrievanceSettlementType } from "../shared/schema/grievance/settlement-schema";

declare module "../../../server/storage/unified-options" {
  interface OptionsTypeNames {
    "grievance-settlement-type": true;
  }
}

registerOptionsContribution({
  id: "grievance.settlement.options.grievance-settlement-type",
  type: "grievance-settlement-type",
  definition: {
    table: optionsGrievanceSettlementType,
    displayName: "Grievance Settlement Type",
    description: "Manage settlement type options for grievances",
    singularName: "Grievance Settlement Type",
    pluralName: "Grievance Settlement Types",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceSettlementType",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance.settlement",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Monetary, Reinstatement, Backpay", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this settlement type", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});
