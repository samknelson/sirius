import type { Request } from "express";
import { buildContext, checkAccessInline } from "../../services/access-policy-evaluator";

export class OnlinePaymentAuthorityError extends Error {
  readonly status = 403;
  constructor(message = "You are not authorized for this online payment action") {
    super(message);
    this.name = "OnlinePaymentAuthorityError";
  }
}

/**
 * Authorize a checkout or saved-method operation without relying on the
 * evaluator's entity cache. Employer grants are deliberately read from the
 * database on every call so revocation takes effect immediately.
 */
export async function assertOnlinePaymentAuthority(
  req: Request,
  entityType: "worker" | "employer",
  entityId: string,
  capability: "pay" | "methods",
): Promise<string> {
  if ((req as any).session?.masqueradeUserId) {
    throw new OnlinePaymentAuthorityError("Online payment actions are unavailable while masquerading");
  }
  const context = await buildContext(req);
  if (!context.user) throw new OnlinePaymentAuthorityError("Authentication required");
  const staff = await checkAccessInline(req, "staff");
  if (staff.granted) throw new OnlinePaymentAuthorityError("Staff cannot perform online payment actions");

  const policy = `${entityType}.ledger.${capability}`;
  if (entityType === "worker") {
    const result = await checkAccessInline(req, policy, entityId);
    if (!result.granted) throw new OnlinePaymentAuthorityError(result.reason);
  } else {
    // Evaluate the capability policy itself: it checks the permission,
    // component, and the current grant in one uncached operation.
    const authorized = await checkAccessInline(req, policy, entityId);
    if (!authorized.granted) {
      throw new OnlinePaymentAuthorityError("No active payment grant for this employer");
    }
  }
  return context.user.id;
}