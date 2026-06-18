import type { Role } from "@shared/schema";
import { createPluginComponentRegistry } from "../_core";

/**
 * Props passed to every dashboard widget. Intentionally narrow: widgets must
 * NOT receive `userPermissions` / `enabledComponents` and must NOT re-check
 * gating on the client. Component + policy gating is enforced server-side by
 * the framework on `GET /api/dashboard-plugins/:pluginId/content` (the same
 * endpoint `useDashboardContent` reads from).
 *
 * If a widget needs the current user identity (e.g. for navigation), it
 * receives `userId` and `userRoles`. Anything else should come from the
 * widget's own `/content` resolver.
 */
export interface DashboardPluginProps {
  userId: string;
  userRoles: Role[];
  componentProps?: Record<string, unknown>;
  /** The config row this widget instance renders (one widget per config). */
  configId?: string;
  /** Admin-set name for this config instance, when present. */
  configName?: string | null;
}

const registry = createPluginComponentRegistry<DashboardPluginProps>({
  kind: "dashboard",
  glob: import.meta.glob("./*/*.tsx", { eager: true }) as Record<
    string,
    Record<string, unknown>
  >,
});

export function hasDashboardComponent(id: string): boolean {
  return registry.has(id);
}

export function resolveDashboardComponent(id: string) {
  return registry.resolve(id);
}
