import type { ComponentDefinition } from "../../../shared/components";

export const components: ComponentDefinition[] = [
  {
    id: "contract.chat",
    name: "Contract Chat",
    description: "Contract-specific chat through configurable webclient vendors, including a local dummy for testing.",
    enabledByDefault: false,
    category: "contract",
    dependsOnComponents: ["contract"],
  },
  {
    id: "contract.chat.foray",
    name: "Contract Chat — Foray",
    description: "Bearer-authenticated Foray service for contract chat, catalog, search, routing and feedback.",
    enabledByDefault: false,
    category: "contract.chat",
    dependsOnComponents: ["contract.chat"],
  },
];
