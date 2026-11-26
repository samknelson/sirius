import { registerMenuPlugin } from "../../../../../../server/plugins/menu/registry";
import { buildConfigMenuItem } from "../../../../../../server/plugins/menu/plugins/default";
import type { MenuItemDef } from "../../../../../../server/plugins/menu/types";

/**
 * Destinations are soft references: this layout neither requires their source
 * nor grants access to them. Match each destination's existing route gates.
 */
function buildT631MenuTree(): MenuItemDef[] {
  return [
    {
      id: "home",
      label: "Home",
      icon: "Home",
      href: "/",
      testId: "nav-home",
    },
    {
      id: "dispatch",
      label: "Dispatch",
      icon: "Briefcase",
      href: "/dispatch/jobs",
      active: { type: "prefix", value: "/dispatch" },
      testId: "nav-dispatch",
      gate: { allOf: [{ component: "dispatch" }, { policy: "staff" }] },
    },
    {
      id: "workers",
      label: "Workers",
      icon: "Users",
      href: "/workers",
      active: { type: "prefix", value: "/workers" },
      testId: "nav-workers",
      gate: { policy: "worker.list" },
    },
    {
      id: "employers",
      label: "Employers",
      icon: "Building2",
      href: "/employers",
      active: { type: "prefix", value: "/employers" },
      testId: "nav-employers",
      gate: { policy: "staff" },
    },
    {
      id: "grievances",
      label: "Grievances",
      icon: "FileText",
      href: "/grievances",
      active: { type: "prefix", value: "/grievance" },
      testId: "nav-grievances-top",
      gate: { allOf: [{ component: "grievance" }, { policy: "staff" }] },
    },
    {
      id: "contract-chat",
      label: "Contract Chat",
      icon: "BookOpen",
      href: "/contract-chat",
      active: { type: "prefix", value: "/contract-chat" },
      testId: "nav-contract-chat",
      gate: { allOf: [{ component: "contract.chat" }, { permission: "contract.chat" }] },
    },
    { ...buildConfigMenuItem(), label: "Config" },
  ];
}

registerMenuPlugin({
  metadata: {
    id: "t631",
    name: "T631",
    description: "Direct links to Home, Dispatch, Workers, Employers, Grievances, Contract Chat, and Config.",
    requiredComponent: "sitespecific.t631",
  },
  buildTree: buildT631MenuTree,
});
