import { lazy } from "react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";

const sections = () => import("./components/grievances/grievance-contract-section");

export const contributions: ComponentBrowserContributions = {
  slots: [
    { slot: "grievance.edit.sections", component: "grievance.contract", section: lazy(() => sections().then(m => ({ default: m.GrievanceContractSection }))) },
    { slot: "grievance.view.sections", component: "grievance.contract", section: lazy(() => sections().then(m => ({ default: m.GrievanceContractSummary }))) },
  ],
};
