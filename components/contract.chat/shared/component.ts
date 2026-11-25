import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "contract.chat",
  name: "Contract Chat",
  description: "Contract-specific chat through configurable webclient vendors, including a local dummy for testing.",
  enabledByDefault: false,
  category: "contract",
  dependsOnComponents: ["contract"],
};
