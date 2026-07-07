import type { Request } from "express";
import { TERMINOLOGY_VARIABLE_NAME } from "@shared/terminology";
import { buildContext, checkAccess } from "../../services/access-policy-evaluator";
import { isComponentEnabled } from "../components";

/**
 * Per-variable read access registry.
 *
 * Maps a variable name to the access tier required to READ it via the
 * generic variable routes (GET /api/variables/by-name/:name and
 * GET /api/variables/:id). Any variable NOT listed here requires the
 * `admin` policy, exactly as before. Write routes are unaffected and
 * stay admin-only.
 *
 * `tier` is either the literal "public" (served with no session) or an
 * access-policy id evaluated by the standard policy evaluator (e.g.
 * "authenticated", "staff", "admin"). An optional `component` gates the
 * variable behind an enabled component in addition to the policy.
 */
export interface VariableReadAccessEntry {
  tier: "public" | string;
  component?: string;
}

const VARIABLE_READ_ACCESS: Record<string, VariableReadAccessEntry> = {
  // Staff-readable, gated by the grievance component (deadline coloring)
  "grievance.deadline_thresholds": { tier: "staff", component: "grievance" },

  // Any authenticated user, gated by the dispatch component
  dispatch_eba_settings: { tier: "authenticated", component: "dispatch" },

  // Fully public — needed by logged-out pages (login screen, header badge)
  system_mode: { tier: "public" },
  site_name: { tier: "public" },
  site_title: { tier: "public" },
  site_footer: { tier: "public" },
  [TERMINOLOGY_VARIABLE_NAME]: { tier: "public" },
};

export type VariableReadDecision =
  | { granted: true }
  | { granted: false; status: 401 | 403; message: string };

/**
 * Decide whether the current request may read the variable with the
 * given name. Unlisted names default to the admin policy.
 * 401 = no session where one is required; 403 = insufficient access
 * or required component disabled.
 */
export async function checkVariableReadAccess(
  req: Request,
  name: string,
): Promise<VariableReadDecision> {
  const entry = VARIABLE_READ_ACCESS[name];

  if (entry?.component) {
    const enabled = await isComponentEnabled(entry.component);
    if (!enabled) {
      return { granted: false, status: 403, message: "Access denied" };
    }
  }

  const tier = entry?.tier ?? "admin";
  if (tier === "public") {
    return { granted: true };
  }

  const context = await buildContext(req);
  if (!context.user) {
    return { granted: false, status: 401, message: "Authentication required" };
  }

  const result = await checkAccess(tier, context.user);
  if (!result.granted) {
    return { granted: false, status: 403, message: "Access denied" };
  }

  return { granted: true };
}
