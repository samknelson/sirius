import type { ComponentDefinition } from "../../../shared/components";

export const component: ComponentDefinition = {
  id: "contract.chat.foray",
  name: "Contract Chat — Foray",
  description: "Bearer-authenticated Foray service for contract chat, catalog, search, routing and feedback.",
  enabledByDefault: false,
  category: "contract.chat",
  dependsOnComponents: ["contract.chat"],
};
