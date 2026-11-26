import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { tabs: [
  { entity: "worker", parent: "identity", before: "bans", tab: { id: "ratings", label: "Ratings", hrefTemplate: "/workers/{id}/ratings", permission: "staff", component: "worker.ratings" } },
] };
