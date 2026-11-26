import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsEdlsTasks, optionsEdlsShowStatus } from "../shared/schema/edls/schema";

declare module "../../../server/storage/unified-options" {
  interface OptionsTypeNames {
    "edls-task": true;
    "edls-show-status": true;
  }
}

registerOptionsContribution({
  id: "edls.options.tasks", type: "edls-task",
  definition: {
    table: optionsEdlsTasks, displayName: "EDLS Task", description: "Manage tasks for the Employer Day Labor Scheduler",
    singularName: "EDLS Task", pluralName: "EDLS Tasks", orderByColumn: "name", loggingModule: "options.edlsTasks",
    bespokePath: "/config/edls/tasks", requiredFields: ["name", "departmentId"], optionalFields: ["siriusId", "data"],
    supportsSequencing: false, requiredComponent: "edls",
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Task name", showInTable: true, columnHeader: "Name" },
      { name: "departmentId", label: "Department", inputType: "select-options", required: true, showInTable: true, columnHeader: "Department", selectOptionsType: "department" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});
registerOptionsContribution({
  id: "edls.options.show-status", type: "edls-show-status",
  definition: {
    table: optionsEdlsShowStatus, displayName: "EDLS Show Status", description: "Manage show statuses for EDLS sheets",
    singularName: "EDLS Show Status", pluralName: "EDLS Show Statuses", orderByColumn: "sequence", loggingModule: "options.edlsShowStatuses",
    requiredComponent: "edls", requiredFields: ["name"], optionalFields: ["siriusId", "sequence", "data"], supportsSequencing: true,
    fields: [
      { name: "name", label: "Name", inputType: "text", required: true, placeholder: "Show status name", showInTable: true, columnHeader: "Name" },
      { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
    ],
  },
});
