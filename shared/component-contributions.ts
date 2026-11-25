import type { HierarchicalTab, TabEntityType } from "./tabRegistry";
import type { MenuItemDef } from "../server/plugins/menu/types";

/** Additive declarations. These are not replacement-value alter hooks. */
export interface ComponentContributions {
  tabs?: { entity: TabEntityType; before?: string; tab: HierarchicalTab }[];
  menu?: { parent: string; before?: string; node: MenuItemDef }[];
  operationAliases?: Record<string, string>;
  carryingBranches?: string[];
}
