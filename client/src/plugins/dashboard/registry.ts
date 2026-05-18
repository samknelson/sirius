import type { ComponentType } from "react";
import type { Role } from "@shared/schema";

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
}

const modules = import.meta.glob("./*/*.tsx", { eager: true }) as Record<
  string,
  Record<string, unknown>
>;

const registry = new Map<string, ComponentType<DashboardPluginProps>>();

for (const [path, mod] of Object.entries(modules)) {
  const match = path.match(/^\.\/([^/]+)\/([^/]+)\.tsx$/);
  if (!match) continue;
  const [, namespace, file] = match;
  const named = mod[file] as ComponentType<DashboardPluginProps> | undefined;
  const fallback = (mod as { default?: ComponentType<DashboardPluginProps> }).default;
  const component = named ?? fallback;
  if (!component) continue;
  registry.set(`${namespace}:${file}`, component);
}

export function hasDashboardComponent(id: string): boolean {
  return registry.has(id);
}

export function resolveDashboardComponent(
  id: string,
): ComponentType<DashboardPluginProps> {
  const component = registry.get(id);
  if (!component) {
    const [namespace, name] = id.split(":");
    throw new Error(
      `Dashboard component "${id}" not found. ` +
        `Add client/src/plugins/dashboard/${namespace}/${name}.tsx ` +
        `exporting a function named "${name}".`,
    );
  }
  return component;
}
