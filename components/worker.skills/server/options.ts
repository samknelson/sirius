import { registerOptionsContribution } from "../../../server/modules/options-contributions";
import { optionsSkills } from "../shared/schema/worker/skills/schema";
declare module "../../../server/storage/unified-options" { interface OptionsTypeNames { skill: true } }
registerOptionsContribution({ id: "worker.skills.options", type: "skill", definition: {
  table: optionsSkills, displayName: "Worker Skill",
  description: "Manage skills and qualifications that can be assigned to workers",
  singularName: "Worker Skill", pluralName: "Worker Skills", orderByColumn: "name",
  loggingModule: "options.skills", requiredFields: ["name"], optionalFields: ["description", "data"],
  supportsSequencing: false, requiredComponent: "worker.skills",
  fields: [
    { name: "icon", label: "Icon", inputType: "icon", required: false, showInTable: true, columnHeader: "Icon", dataField: true },
    { name: "name", label: "Name", inputType: "text", required: true, placeholder: "e.g., Welding, Plumbing, Electrical", showInTable: true, columnHeader: "Name" },
    { name: "description", label: "Description", inputType: "textarea", required: false, placeholder: "Optional description of this skill", showInTable: true, columnHeader: "Description" },
  ],
} });
