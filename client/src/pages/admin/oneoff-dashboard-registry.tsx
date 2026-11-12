import { lazy, type ComponentType } from "react";

export type OneoffDashboardProps = { configId: string };

/** Read-only dashboards are separate from action-input renderers. */
export const oneoffDashboards: Record<string, ComponentType<OneoffDashboardProps>> = {
  "s1-migration": lazy(() => import("@/plugins/oneoff/s1-migration/dashboard")),
};
