import type { ComponentDefinition } from "../../../shared/components";
export const component: ComponentDefinition = {
  id: "sitespecific.t631.client",
  name: "Teamsters 631 Client",
  description: "Client connection to the Teamsters 631 site",
  enabledByDefault: false,
  category: "site-specific",
  dependsOnComponents: ["worker.tos", "worker.aat"],
};
