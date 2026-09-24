/**
 * Shared types for the pluggable main-menu system.
 *
 * The server resolves the selected menu plugin's tree per user (evaluating
 * permission / policy / component gates) and returns `ResolvedMenu` from
 * GET /api/menu. The client renders it generically (desktop dropdowns +
 * mobile sheet) mapping `icon` names to lucide components.
 */

/** How the client decides whether an item is "active" for the current route. */
export interface MenuActiveMatch {
  type: "exact" | "prefix" | "includes";
  value: string;
}

/** A single, fully access-filtered menu item as delivered to the client. */
export interface ResolvedMenuItem {
  id: string;
  /** Static label. Exactly one of label / labelTerm is set. */
  label?: string;
  /** Terminology-driven label resolved client-side via the term registry. */
  labelTerm?: { key: string; plural?: boolean };
  /** Lucide icon name (client maps unknown names to a fallback). */
  icon: string;
  /** Route for leaf items. Parents without href are pure dropdown triggers. */
  href?: string;
  /** Active-state matcher; defaults to exact match on href. */
  active?: MenuActiveMatch;
  /** data-testid base (desktop: as-is, menu items keep their own ids). */
  testId?: string;
  /** Render a separator above this item (dropdown/mobile). */
  separatorBefore?: boolean;
  children?: ResolvedMenuItem[];
}

export interface ResolvedMenu {
  /** Menu plugin id the tree was built from. */
  plugin: string;
  items: ResolvedMenuItem[];
}

/** Variable that stores the selected menu plugin id (unset ⇒ "default"). */
export const SITE_MENU_PLUGIN_VARIABLE = "site_menu_plugin";
export const DEFAULT_MENU_PLUGIN_ID = "default";
