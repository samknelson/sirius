import { alterHooks } from "@shared/alter";
import { samlObservationHook, type RoleReconciliationFacts } from "../../../server/auth/saml-observation";
import { storageLogger } from "../../../server/logger";
import { getRequestContext } from "../../../server/middleware/request-context";

function explainRoles(f: RoleReconciliationFacts) {
  if (f.outcome === "error") {
    const err = f.error instanceof Error ? f.error : new Error(String(f.error));
    return { outcome: f.outcome, identityId: f.identityId, error: { name: err.name, message: err.message, stack: err.stack } };
  }
  if (f.outcome === "no_mappings") return { outcome: f.outcome, identityId: f.identityId, mappings: [] };
  const known = new Map(f.allRoles!.map(r => [r.id, r.name]));
  const held = new Set(f.heldRoleIds!);
  const describe = (ids: Iterable<string>) => Array.from(ids, roleId => ({ roleId, role: known.get(roleId) ?? roleId }));
  return {
    outcome: f.outcome, identityId: f.identityId,
    mappings: f.mappings!.map((mapping, index) => {
      const raw = f.attributes![mapping.attribute];
      const matched = f.matching![index];
      let result: string;
      if (!matched) {
        if (raw === undefined) result = "missing_attribute";
        else if (raw === null || raw === "" || (Array.isArray(raw) && raw.every(v => String(v) === ""))) result = "empty_attribute";
        else result = "value_mismatch";
      } else if (!known.has(mapping.roleId)) result = "unknown_role";
      else if (held.has(mapping.roleId)) result = f.previousManaged!.includes(mapping.roleId) ? "already_managed" : "already_held_locally";
      else result = "granted";
      return {
        attribute: mapping.attribute, expectedValue: mapping.value, actualValue: raw ?? null,
        matched, roleId: mapping.roleId, roleName: known.get(mapping.roleId) ?? null,
        roleExists: known.has(mapping.roleId), result,
      };
    }),
    rolesBefore: describe(held),
    rolesAfter: describe(new Set([...held].filter(id => !f.revoked!.includes(id)).concat(f.granted!))),
    managedRoleIdsBefore: f.previousManaged, managedRoleIdsAfter: f.nextManagedList,
    granted: describe(f.granted!), revoked: describe(f.revoked!), metadataUpdated: f.changedManaged,
  };
}
export function registerSamlCapture() {
  alterHooks.registerSync(samlObservationHook, {
    id: "debug.saml.capture", component: "debug", priority: 10, metadata: {},
    description: "Capture full SAML assertions and explain role reconciliation privately",
    alter(value, { request: req, outcome, options }) {
      const raw = req.body?.SAMLResponse;
      storageLogger.info(`SAML debug capture [${outcome}]`, {
        publishEvent: false,
        module: "saml_debug", operation: outcome,
        description: `SAML login attempt outcome: ${outcome}`,
        ip_address: getRequestContext()?.ipAddress ?? req.ip,
        profileAttributes: options.profile ? { ...options.profile } : null,
        samlResponseBase64: typeof raw === "string" ? raw : undefined,
        samlResponseXml: typeof raw === "string" && raw ? Buffer.from(raw, "base64").toString("utf8") : undefined,
        relayState: typeof req.body?.RelayState === "string" ? req.body.RelayState : undefined,
        matchedEmail: options.matchedEmail,
        matchedUserId: options.matchedUserId !== undefined ? String(options.matchedUserId) : undefined,
        externalId: options.externalId,
        roleReconciliation: options.roleReconciliation ? explainRoles(options.roleReconciliation) : undefined,
        errorCategory: options.errorCategory, errorMessage: options.errorMessage,
      });
      return value;
    },
  });
}
