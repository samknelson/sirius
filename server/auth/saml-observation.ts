import type { Request } from "express";
import { alterHooks } from "@shared/alter";
import type { SamlRoleMapping } from "./auth-settings";

/** Private facts, never published on the event bus or projected into catalogs. */
export interface RoleReconciliationFacts {
  outcome: "no_mappings" | "no_changes" | "changed" | "error";
  identityId: string;
  mappings?: SamlRoleMapping[];
  attributes?: Record<string, unknown>;
  matching?: boolean[];
  allRoles?: Array<{ id: string; name: string }>;
  heldRoleIds?: string[];
  previousManaged?: string[];
  nextManagedList?: string[];
  granted?: string[];
  revoked?: string[];
  changedManaged?: boolean;
  error?: unknown;
}
export interface SamlObservation {
  request: Request;
  outcome: "success" | "access_denied" | "saml_error";
  options: {
    profile?: Record<string, unknown> | null;
    matchedEmail?: string;
    matchedUserId?: string | number;
    externalId?: string;
    errorCategory?: string;
    errorMessage?: string;
    roleReconciliation?: RoleReconciliationFacts;
  };
}
export const samlObservationHook = alterHooks.declareSync<null, SamlObservation>({
  id: "auth.saml.observation",
  description: "Observe a private SAML authentication outcome",
  semantics: "Best-effort private observation only. Must not mutate identity, roles, request or access decisions. No event publication.",
});
export function observeSaml(request: Request, outcome: SamlObservation["outcome"], options: SamlObservation["options"] = {}): void {
  try { alterHooks.runSync(samlObservationHook, null, { request, outcome, options }); }
  catch { /* Optional observation must never change authentication. */ }
}
