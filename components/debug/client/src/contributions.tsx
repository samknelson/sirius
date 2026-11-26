import { lazy } from "react";
import { Radio } from "lucide-react";
import type { ComponentBrowserContributions } from "../../../../client/src/lib/component-contributions";
import { RECORD_ACTIONS_SLOT } from "../../../../client/src/lib/record-actions";
import { ELIGIBLE_WORKER_ACTIONS_SLOT } from "../../../../client/src/lib/eligible-worker-actions";
import { ECHP_INPUTS_SLOT } from "../../../../client/src/lib/echp-inputs";

export const contributions: ComponentBrowserContributions = {
  routes: [{
    path: "/admin/debug/event-bus", layout: "bare",
    page: lazy(() => import("./pages/event-bus-route")),
  }],
  navigation: [{
    section: "system", before: "/admin/ebs",
    item: { path: "/admin/debug/event-bus", label: "Event Bus", icon: Radio, testId: "nav-admin-debug-event-bus", permission: "admin", requiresComponent: "debug" },
  }],
  slots: [
    { slot: RECORD_ACTIONS_SLOT, component: "debug", section: lazy(() => import("./components/DebugRecordViewer").then(m => ({ default: m.DebugRecordViewer }))) },
    { slot: ELIGIBLE_WORKER_ACTIONS_SLOT, component: "debug", section: lazy(() => import("./components/EligibleWorkersSql")) },
    { slot: ECHP_INPUTS_SLOT, component: "debug", section: lazy(() => import("./components/EchpInputs")) },
  ],
};
