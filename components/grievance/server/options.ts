import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { storage } from "../../../server/storage";
import { optionsGrievanceCategory, optionsGrievanceComplaints, optionsGrievanceRemedies, optionsGrievanceRoles, optionsGrievanceStatus, optionsGrievanceSteps } from "../shared/schema/grievance/schema";

declare module "../../../server/storage/unified-options" {
  interface OptionsTypeNames {
    "grievance-status": true;
    "grievance-category": true;
    "grievance-step": true;
    "grievance-complaint": true;
    "grievance-remedy": true;
    "grievance-role": true;
  }
}

registerOptionsContribution({
  id: "grievance.options.grievance-status",
  type: "grievance-status",
  // Timeline-template steps store status ids as plain arrays (no FK), so a
  // referenced status must not be deleted out from under them.
  async deleteGuard(id) {
    const referenced = await storage.grievanceTimelineTemplates.isStatusReferenced(id);
    return referenced
      ? {
          status: 409,
          message:
            "This status is used by a grievance timeline template and cannot be deleted. Remove it from all timeline steps first.",
        }
      : null;
  },
  definition: {
    table: optionsGrievanceStatus,
    displayName: "Grievance Status",
    description: "Manage status options for grievances",
    singularName: "Grievance Status",
    pluralName: "Grievance Statuses",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceStatus",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "open", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Open, In Review, Resolved", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this status", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
      { name: "open", label: "Open", inputType: "checkbox", required: false, default: true, helperText: "Marks whether this status represents an open grievance state", showInTable: true, columnHeader: "Open" },
    ],
  },
});

registerOptionsContribution({
  id: "grievance.options.grievance-category",
  type: "grievance-category",
  definition: {
    table: optionsGrievanceCategory,
    displayName: "Grievance Category",
    description: "Manage category options for grievances",
    singularName: "Grievance Category",
    pluralName: "Grievance Categories",
    orderByColumn: "name" as const,
    loggingModule: "options.grievanceCategory",
    requiredFields: ["name"],
    optionalFields: ["description", "data"],
    supportsSequencing: false,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Discipline, Pay, Safety", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this category", showInTable: true, columnHeader: "Description" },
    ],
  },
});

registerOptionsContribution({
  id: "grievance.options.grievance-step",
  type: "grievance-step",
  definition: {
    table: optionsGrievanceSteps,
    displayName: "Grievance Step",
    description: "Manage step options for grievances",
    singularName: "Grievance Step",
    pluralName: "Grievance Steps",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceStep",
    requiredFields: ["name", "actor"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Step 1, Mediation", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this step", showInTable: true, columnHeader: "Description" },
      { name: "actor", label: "Actor", inputType: "enum", required: true, enumOptions: [{ value: "union", label: "Union" }, { value: "employer", label: "Employer" }], showInTable: true, columnHeader: "Actor" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});

registerOptionsContribution({
  id: "grievance.options.grievance-complaint",
  type: "grievance-complaint",
  definition: {
    table: optionsGrievanceComplaints,
    displayName: "Grievance Complaint",
    description: "Manage complaint options for grievances",
    singularName: "Grievance Complaint",
    pluralName: "Grievance Complaints",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceComplaint",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Wrongful Termination, Pay Dispute", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this complaint", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});

registerOptionsContribution({
  id: "grievance.options.grievance-remedy",
  type: "grievance-remedy",
  definition: {
    table: optionsGrievanceRemedies,
    displayName: "Grievance Remedy",
    description: "Manage remedy options for grievances",
    singularName: "Grievance Remedy",
    pluralName: "Grievance Remedies",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceRemedy",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Reinstatement, Back Pay", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this remedy", showInTable: true, columnHeader: "Description" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});

registerOptionsContribution({
  id: "grievance.options.grievance-role",
  type: "grievance-role",
  definition: {
    table: optionsGrievanceRoles,
    displayName: "Grievance Role",
    description: "Manage role options for grievances",
    singularName: "Grievance Role",
    pluralName: "Grievance Roles",
    orderByColumn: "sequence" as const,
    loggingModule: "options.grievanceRole",
    requiredFields: ["name"],
    optionalFields: ["description", "siriusId", "sequence", "data"],
    supportsSequencing: true,
    requiredComponent: "grievance",
    fields: [
      { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", columnWidth: "80px", dataField: true },
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Grievant, Steward, Witness", showInTable: true, columnHeader: "Name" },
      { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this role", showInTable: true, columnHeader: "Description" },
      { name: "permittedSystemRoleIds", label: "Permitted System Roles", inputType: "system-roles", required: false, helperText: "Only users holding one of these system roles can be assigned this grievance role. Leave empty to allow any user.", showInTable: false, dataField: true },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});
