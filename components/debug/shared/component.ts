import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "debug",
  name: "Debug",
  description: "Debug tools and developer utilities",
  enabledByDefault: false,
  category: "developer",
  permissions: [{ key: "debug", description: "Access to debug tools and raw data viewers" }],
};
