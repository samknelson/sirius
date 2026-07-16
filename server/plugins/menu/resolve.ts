import type { Request } from "express";
import type { ResolvedMenu, ResolvedMenuItem } from "@shared/menu-types";
import { DEFAULT_MENU_PLUGIN_ID, SITE_MENU_PLUGIN_VARIABLE } from "@shared/menu-types";
import { buildContext, checkAccessInline } from "../../services/access-policy-evaluator";
import { isComponentEnabled } from "../../modules/components";
import { storage } from "../../storage";
import { menuPluginRegistry } from "./registry";
import type { MenuGate, MenuItemDef } from "./types";

interface GateContext {
  req: Request;
  userId: string;
  workerId: string | null;
  permissionCache: Map<string, Promise<boolean>>;
  policyCache: Map<string, Promise<boolean>>;
}

function hasPermissionCached(ctx: GateContext, key: string): Promise<boolean> {
  let cached = ctx.permissionCache.get(key);
  if (!cached) {
    // Mirrors the client's old `hasPermission` (exact membership in the
    // user's permission set — deliberately NO admin bypass, matching the
    // list `/api/auth/user` hands the client).
    cached = storage.users
      .getUserPermissions(ctx.userId)
      .then((perms: Array<{ key: string }>) => perms.some((p) => p.key === key));
    ctx.permissionCache.set(key, cached);
  }
  return cached;
}

function checkPolicyCached(ctx: GateContext, policyId: string): Promise<boolean> {
  let cached = ctx.policyCache.get(policyId);
  if (!cached) {
    cached = checkAccessInline(ctx.req, policyId).then((r) => r.granted);
    ctx.policyCache.set(policyId, cached);
  }
  return cached;
}

async function evaluateGate(gate: MenuGate, ctx: GateContext): Promise<boolean> {
  if ("permission" in gate) return hasPermissionCached(ctx, gate.permission);
  if ("policy" in gate) return checkPolicyCached(ctx, gate.policy);
  if ("component" in gate) return isComponentEnabled(gate.component);
  if ("workerLinked" in gate) return ctx.workerId !== null;
  if ("not" in gate) return !(await evaluateGate(gate.not, ctx));
  if ("allOf" in gate) {
    for (const g of gate.allOf) {
      if (!(await evaluateGate(g, ctx))) return false;
    }
    return true;
  }
  if ("anyOf" in gate) {
    for (const g of gate.anyOf) {
      if (await evaluateGate(g, ctx)) return true;
    }
    return false;
  }
  return false;
}

/**
 * Look up the employers associated with the requesting user's contact —
 * same resolution the old `/api/my-employers`-driven header used.
 */
async function getMyEmployers(email: string | null | undefined): Promise<Array<{ id: string; name: string }>> {
  if (!email) return [];
  const contact = await storage.contacts?.getContactByEmail?.(email);
  if (!contact) return [];
  const links = await storage.employerContacts.listByContactId(contact.id);
  const employerIds = Array.from(new Set(links.map((l: any) => l.employerId)));
  const employers = await Promise.all(employerIds.map((id) => storage.employers.getEmployer(id)));
  return employers
    .filter((e): e is NonNullable<typeof e> => !!e && e.isActive)
    .map((e) => ({ id: e.id, name: e.name }));
}

function expandMyEmployers(
  def: MenuItemDef,
  employers: Array<{ id: string; name: string }>,
): ResolvedMenuItem | null {
  if (employers.length === 0) return null;
  if (employers.length === 1) {
    return {
      id: def.id,
      label: "My Employer",
      icon: def.icon,
      href: `/employers/${employers[0].id}`,
      active: { type: "exact", value: `/employers/${employers[0].id}` },
      testId: def.testId,
    };
  }
  return {
    id: def.id,
    label: "My Employers",
    icon: def.icon,
    testId: def.testId,
    children: employers.map((e) => ({
      id: `${def.id}-${e.id}`,
      label: e.name,
      icon: "Building2",
      href: `/employers/${e.id}`,
      active: { type: "exact", value: `/employers/${e.id}` },
      testId: `menu-my-employer-${e.id}`,
    })),
  };
}

async function resolveItems(
  defs: MenuItemDef[],
  ctx: GateContext,
  employers: Array<{ id: string; name: string }>,
): Promise<ResolvedMenuItem[]> {
  const out: ResolvedMenuItem[] = [];
  for (const def of defs) {
    if (def.gate && !(await evaluateGate(def.gate, ctx))) continue;

    if (def.special === "myEmployers") {
      const expanded = expandMyEmployers(def, employers);
      if (expanded) out.push(expanded);
      continue;
    }

    let children: ResolvedMenuItem[] | undefined;
    if (def.children && def.children.length > 0) {
      children = await resolveItems(def.children, ctx, employers);
      // A dropdown parent with no surviving children is dropped entirely.
      if (children.length === 0) continue;
    }

    let href = def.href;
    if (href && href.includes(":workerId")) {
      if (!ctx.workerId) continue;
      href = href.replace(":workerId", ctx.workerId);
    }
    let active = def.active;
    if (active && active.value.includes(":workerId") && ctx.workerId) {
      active = { ...active, value: active.value.replace(":workerId", ctx.workerId) };
    }

    out.push({
      id: def.id,
      label: def.label,
      labelTerm: def.labelTerm,
      icon: def.icon,
      href,
      active,
      testId: def.testId,
      separatorBefore: def.separatorBefore,
      children,
    });
  }
  return out;
}

/**
 * Resolve the selected menu plugin's tree for the requesting user.
 * Reads the `site_menu_plugin` variable (falling back to `default` when
 * unset or naming an unknown plugin) and evaluates every gate.
 */
export async function resolveMenuForRequest(
  req: Request,
  overridePluginId?: string,
): Promise<ResolvedMenu> {
  const context = await buildContext(req);
  if (!context.user) {
    return { plugin: DEFAULT_MENU_PLUGIN_ID, items: [] };
  }

  let pluginId = DEFAULT_MENU_PLUGIN_ID;
  if (overridePluginId && menuPluginRegistry.has(overridePluginId)) {
    pluginId = overridePluginId;
  } else {
    try {
      const variable = await storage.variables.getByName(SITE_MENU_PLUGIN_VARIABLE);
      if (variable?.value) {
        const raw = typeof variable.value === "string" ? variable.value : String(variable.value);
        const candidate = raw.replace(/^"|"$/g, "");
        if (menuPluginRegistry.has(candidate)) {
          pluginId = candidate;
        }
      }
    } catch {
      // Fall back to the default menu on any variable-read hiccup.
    }
  }

  const plugin = menuPluginRegistry.get(pluginId) ?? menuPluginRegistry.get(DEFAULT_MENU_PLUGIN_ID);
  if (!plugin) {
    return { plugin: pluginId, items: [] };
  }

  // Linked worker: same resolution /api/auth/user uses for `user.workerId`.
  let workerId: string | null = null;
  if (context.user.email) {
    const worker = await storage.workers.getWorkerByContactEmail(context.user.email);
    if (worker) workerId = worker.id;
  }

  const tree = plugin.buildTree();

  // Only fetch employers when some item actually needs them.
  const needsEmployers = (defs: MenuItemDef[]): boolean =>
    defs.some((d) => d.special === "myEmployers" || (d.children ? needsEmployers(d.children) : false));
  const employers = needsEmployers(tree) ? await getMyEmployers(context.user.email) : [];

  const ctx: GateContext = {
    req,
    userId: context.user.id,
    workerId,
    permissionCache: new Map(),
    policyCache: new Map(),
  };

  const items = await resolveItems(tree, ctx, employers);
  return { plugin: plugin.metadata.id, items };
}
