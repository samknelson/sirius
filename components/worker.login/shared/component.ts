import type { ComponentDefinition } from "../../../shared/components";

// Shared authentication and the core `worker` permission deliberately remain
// independent of this optional definition and its persisted enablement switch.
export const component: ComponentDefinition = {
  id: "worker.login",
  name: "Worker Login",
  description: "Ability for workers to log in",
  enabledByDefault: false,
  category: "authentication",
  permissions: [{ key: "worker", description: "Worker level access" }],
};
