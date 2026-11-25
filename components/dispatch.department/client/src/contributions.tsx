import { lazy } from "react";
import { componentTabRoute } from "../../../../client/src/lib/component-routes";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { DepartmentForm, DepartmentSummary, DepartmentListProvider, DepartmentCell, DepartmentCardField } from "./job-ui";
export const contributions: ComponentBrowserContributions = {
  routes: [{ path: "/workers/:id/dispatch/departments", layout: "bare", page: componentTabRoute(lazy(() => import("./pages/workers/dispatch-departments")), "dispatch-departments", "worker") }],
  dispatchUi: [{ component: "dispatch.department", jobForm: DepartmentForm, jobSummary: DepartmentSummary, jobListColumn: { id: "dispatch.department", title: "Department", provider: DepartmentListProvider, cell: DepartmentCell, cardField: DepartmentCardField } }],
};
