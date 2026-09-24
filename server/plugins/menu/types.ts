import type { MenuActiveMatch } from "@shared/menu-types";
import type { BasePluginMetadata } from "../_core/types";

/**
 * Access gate for a menu item. Evaluated server-side per user by the
 * menu resolver (`resolve.ts`). Composable with not / allOf / anyOf so
 * the boolean combinations the old hardcoded header used can be
 * expressed declaratively.
 */
export type MenuGate =
  | { permission: string }
  | { policy: string }
  | { component: string }
  | { workerLinked: true }
  | { not: MenuGate }
  | { allOf: MenuGate[] }
  | { anyOf: MenuGate[] };

/**
 * Declarative menu item. `href` may contain the `:workerId` placeholder,
 * substituted with the requesting user's linked worker id at resolve
 * time (items using it should also gate on `workerLinked`).
 */
export interface MenuItemDef {
  id: string;
  label?: string;
  labelTerm?: { key: string; plural?: boolean };
  icon: string;
  href?: string;
  active?: MenuActiveMatch;
  testId?: string;
  separatorBefore?: boolean;
  gate?: MenuGate;
  /**
   * Dynamic expansion handled by the resolver:
   * - "myEmployers": replaced by the user's associated employers —
   *   hidden when none, a single link when one, a dropdown when many.
   */
  special?: "myEmployers";
  children?: MenuItemDef[];
}

/**
 * A menu plugin defines a complete menu tree via `buildTree()`. Plugins
 * wanting to reuse another plugin's structure call that plugin's exported
 * builder directly and modify the result (no extend/patch framework).
 */
export interface MenuPlugin {
  metadata: BasePluginMetadata;
  buildTree(): MenuItemDef[];
}

/** Manifest entry shape returned by /api/plugins/menu/manifest. */
export interface MenuManifestEntry {
  id: string;
  name: string;
  description: string;
}
