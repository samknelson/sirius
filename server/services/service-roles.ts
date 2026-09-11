import type { Express, RequestHandler } from "express";
import {
  classifySystemServicePath,
  getSystemServiceRoleEntries,
  type SystemServiceRole,
} from "@shared/system-service-roles";
import { getEnvironmentVariable } from "../config/env-registry";

export type RequestTrafficClass = SystemServiceRole;

export interface ResolvedServiceRoles {
  readonly ids: readonly SystemServiceRole[];
  has(role: SystemServiceRole): boolean;
}

/**
 * Resolve SERVICE_ROLE once, before the app starts. The catalog declaration is
 * the vocabulary: no second role allowlist is maintained here.
 */
export function resolveServiceRoles(): ResolvedServiceRoles {
  const raw = getEnvironmentVariable("SERVICE_ROLE");
  const available = getSystemServiceRoleEntries();
  const known = new Set<string>(available.map((role) => role.id));
  const ids = raw === undefined
    ? available.map((role) => role.id)
    : raw.split(",").map((member, index) => {
        const id = member.trim();
        if (!id) {
          throw new Error(
            `Invalid SERVICE_ROLE: member ${index + 1} is empty. ` +
              `Use a comma-separated list of ${available.map((role) => role.id).join(", ")}.`,
          );
        }
        if (!known.has(id)) {
          throw new Error(
            `Invalid SERVICE_ROLE: "${id}" is not a recognized role. ` +
              `Allowed roles: ${available.map((role) => role.id).join(", ")}.`,
          );
        }
        return id as SystemServiceRole;
      });

  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length) {
    throw new Error(
      `Invalid SERVICE_ROLE: duplicate role${duplicates.length === 1 ? "" : "s"} ` +
        `${Array.from(new Set(duplicates)).map((id) => `"${id}"`).join(", ")}.`,
    );
  }

  const selected = new Set<SystemServiceRole>(ids);
  return {
    ids,
    has: (role) => selected.has(role),
  };
}

/** Classify using path segments, so /api/wsfoo remains a user API request. */
export function classifyRequestTraffic(path: string): RequestTrafficClass {
  return classifySystemServicePath(path);
}

/**
 * A single last-resort ownership refusal. Install before any route surface or
 * static fallback so a request cannot accidentally fall through to index.html.
 */
export function installServiceRoleOwnershipGuard(
  app: Express,
  roles: ResolvedServiceRoles,
): void {
  const guard: RequestHandler = (req, res, next) => {
    const requiredRole = classifyRequestTraffic(req.path);
    if (roles.has(requiredRole)) return next();
    res.status(503).json({
      error: "Service Unavailable",
      code: "SERVICE_ROLE_NOT_ASSIGNED",
      message: `This container does not serve ${requiredRole} traffic.`,
      requiredRole,
      serviceRoles: roles.ids,
    });
  };
  app.use(guard);
}