import { randomBytes } from "node:crypto";
import { storageLogger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";

export type AccountRefusalReason =
  | "missing_external_id"
  | "identity_found_but_user_missing"
  | "inactive_account"
  | "missing_email"
  | "no_provisioned_account";

export type AccountAccessResult =
  | { allowed: true; user: any }
  | { allowed: false; reason: AccountRefusalReason };

/** Only call after provider verification, never for restored-session refusals. */
export function recordAccountRefusal(
  provider: "replit" | "clerk",
  reason: AccountRefusalReason,
  profile: { externalId?: string; email?: string },
): string {
  const reference = `${provider.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
  const descriptions: Record<AccountRefusalReason, string> = {
    missing_external_id: "The verified identity has no external subject identifier.",
    identity_found_but_user_missing: "The identity is linked to a user account that no longer exists.",
    inactive_account: "The account is inactive. Re-activate it in Users to allow sign-in.",
    missing_email: "The verified identity has no email and no existing account link.",
    no_provisioned_account: "No provisioned account was found and automatic provisioning did not create one.",
  };
  try {
    storageLogger.error(`${provider.toUpperCase()} access denied [${reference}]`, {
      module: "auth",
      operation: "access_denied",
      description: descriptions[reason],
      provider,
      reference,
      category: reason,
      attemptedEmail: profile.email,
      attemptedExternalId: profile.externalId,
      ip_address: getRequestContext()?.ipAddress,
    });
  } catch { /* Logging must not change the access decision. */ }
  const params = new URLSearchParams({ error: "access_denied", ref: reference });
  if (reason === "inactive_account") params.set("category", reason);
  return `/auth-error?${params}`;
}

/** Internal callback outcome; protocol errors never acquire account details. */
export class VerifiedAccountRefusal extends Error {
  constructor(readonly redirectUrl: string) {
    super("Verified identity refused application access");
  }
}
