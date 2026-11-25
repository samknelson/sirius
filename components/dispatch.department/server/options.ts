import { registerOptionsContribution } from "../../../server/modules/options-contributions";
registerOptionsContribution({
  id: "dispatch.department.available",
  type: "department",
  fields: [{ name: "availableForDispatch", label: "Available for dispatch?", inputType: "checkbox", required: false, helperText: "Allow this department to be selected on dispatch jobs and worker department preferences", showInTable: true, columnHeader: "Available for Dispatch", dataField: true, requiredComponent: "dispatch.department" }],
});
