import type { ComponentStartup } from "../../../server/services/component/startup-types";
import { alterHooks } from "../../../shared/alter";
import { tabEntityPolicyHook } from "../../../shared/tab-visibility";
import { policyRequestInputsHook } from "../../../server/modules/access-policies";
import { menuTreeHook } from "../../../server/plugins/menu/resolve";
import type { MenuItemDef } from "../../../server/plugins/menu/types";
import { registerEntityLoader } from "../../../server/services/access-policy-evaluator";
import { registerSnapshotEntityType } from "../../../server/modules/snapshots";
import { registerEdlsCommViewAlter } from "./services/edls/comm-view-alter";
import { registerEdlsSnapshotCapture } from "./snapshot-capture";
import { isComponentEnabledSync } from "../../../server/services/component/cache";
import { edlsSheetStatusEnum } from "../shared/schema/edls/schema";
import { decodeEdlsSheetSnapshot } from "./modules/edls/snapshot-decode";
import { registerEdlsSheetsRoutes } from "./modules/edls/sheets";
import { registerEdlsAssignmentExplorerRoutes } from "./modules/edls/assignment-explorer";
import { registerEdlsTasksRoutes } from "./modules/edls/tasks";
import { registerWorkerEdlsRoutes } from "./modules/edls/workers";
import { registerEdlsLogsRoutes } from "./modules/edls/logs";
import "../shared/access-policies/edls/any";
import "../shared/access-policies/edls/reader";
import "../shared/access-policies/edls/coordinator";
import "../shared/access-policies/edls/sheet/view";
import "../shared/access-policies/edls/sheet/edit";
import "../shared/access-policies/edls/sheet/assign";
import "../shared/access-policies/edls/sheet/create";
import "../shared/access-policies/edls/sheet/manage";
import "../shared/access-policies/edls/sheet/copy";
import "../shared/access-policies/edls/sheet/manage-view";
import "../shared/access-policies/edls/sheet/set-status";

export function register(): void {
  registerEdlsCommViewAlter();
  registerEntityLoader("edls_sheet", async (id, injectedStorage) =>
    isComponentEnabledSync("edls") ? await injectedStorage.edlsSheets.get(id) ?? null : null);
  registerSnapshotEntityType("edls_sheet", { policyId: "edls.sheet.view", component: "edls", decode: decodeEdlsSheetSnapshot });
  registerEdlsSnapshotCapture();
  alterHooks.register(tabEntityPolicyHook, {
    id: "edls.tab-entity-policy", component: "edls", priority: 0,
    description: "Base access for sheet tabs", metadata: {},
    alter: (policy, { entityType }) => entityType === "edls_sheet" ? "edls.sheet.view" : policy,
  });
  alterHooks.register(policyRequestInputsHook, {
    id: "edls.policy-inputs", component: "edls", priority: 0,
    description: "Validate the sheet status policy target", metadata: {},
    alter(values, { policyId, inputs }) {
      const value = inputs.targetStatus;
      if (policyId !== "edls.sheet.set_status" || typeof value !== "string" ||
        !edlsSheetStatusEnum.some(status => status === value)) return values;
      return { ...values, targetStatus: value };
    },
  });
  alterHooks.register(menuTreeHook, {
    id: "edls.reports-menu", component: "edls", priority: 0,
    description: "Allow sheet readers to discover reports without granting destination access", metadata: {},
    alter(tree, { pluginId }) {
      if (pluginId !== "default") return tree;
      const visit = (items: MenuItemDef[]): MenuItemDef[] => items.map(item => ({
        ...item,
        ...(item.id === "reports" || item.id === "reports-all"
          ? { gate: { anyOf: [...(item.gate ? [item.gate] : []), { policy: "edls.reader" }] } } : {}),
        ...(item.children ? { children: visit(item.children) } : {}),
      }));
      return visit(tree);
    },
  });
}

export const registerRoutes: NonNullable<ComponentStartup["registerRoutes"]> = (app, auth, permission) => {
  registerEdlsSheetsRoutes(app, auth, permission);
  registerEdlsAssignmentExplorerRoutes(app, auth);
  registerEdlsTasksRoutes(app, auth, permission);
  registerWorkerEdlsRoutes(app, auth);
  registerEdlsLogsRoutes(app, auth);
};
