import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsWorkerRatings } from "../shared/schema/worker/ratings/schema";
declare module "../../../server/storage/unified-options" { interface OptionsTypeNames { "worker-rating": true } }
registerOptionsContribution({ id: "worker.ratings.options", type: "worker-rating", definition: {
  table: optionsWorkerRatings, displayName: "Worker Rating Type",
  description: "Manage rating types for evaluating workers. Ratings can have parent ratings to create a hierarchy.",
  singularName: "Worker Rating Type", pluralName: "Worker Rating Types", orderByColumn: "name",
  loggingModule: "options.workerRatings", requiredFields: ["name"], optionalFields: ["parent", "siriusId", "data"],
  supportsParent: true, requiredComponent: "worker.ratings", supportsSequencing: false,
  fields: [
    { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Quality, Attendance, Teamwork", showInTable: true, columnHeader: "Name" },
    { name: "parent", label: "Parent Rating", inputType: "select-self", required: false, helperText: "Select a parent to create a hierarchy", showInTable: true, columnHeader: "Parent" },
    { name: "siriusId", label: "Sirius ID", inputType: "text", required: false, placeholder: "External ID", showInTable: true, columnHeader: "Sirius ID" },
  ],
} });
