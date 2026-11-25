import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "dispatch.ban", name: "Dispatch Ban",
  description: "Excludes workers with active dispatch bans from dispatch eligibility",
  enabledByDefault: false, category: "dispatch",
};
