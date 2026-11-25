import type { ComponentContributions } from "../../../shared/component-contributions";
import type {} from "../../grievance/shared/contributions";

export const contributions: ComponentContributions = {
  tabs: [
    { entity: "grievance", before: "files", tab: { id: 'settlements', label: 'Settlements', hrefTemplate: '/grievance/{id}/settlements', permission: 'staff', component: 'grievance.settlement' } },
  ],
};
