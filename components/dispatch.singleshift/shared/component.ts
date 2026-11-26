import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "dispatch.singleshift", name: "Single Shift Dispatch",
  description: "Manages single-shift dispatch assignments for workers",
  enabledByDefault: false, category: "dispatch",
  dependsOnComponents: ["dispatch"],
};
