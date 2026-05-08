import { storage } from "../storage";
import { logger } from "../logger";
import {
  getActiveOktaIssuerUrl,
  getPersonaConfig,
  lookupOrCreateOktaUserForPersona,
  type OktaPersona,
  type OktaProvisionOutcome,
} from "../auth/okta-admin";

export type CredentialOktaOutcome =
  | OktaProvisionOutcome
  | "already_linked";

export interface CredentialOktaResult {
  outcome: CredentialOktaOutcome;
  oktaUserId: string;
  email: string;
  message: string;
}

export interface CredentialOktaArgs {
  userId: string;
  persona: OktaPersona;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}

const OUTCOME_MESSAGES: Record<CredentialOktaOutcome, string> = {
  already_linked: "This user is already linked to an Okta account.",
  linked_existing:
    "Linked to existing Okta account. The user can sign in immediately.",
  created_and_activated:
    "Activation email sent. The user must complete Okta activation before signing in.",
};

export class OktaCredentialingError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * Admin-driven credentialing: ensure the given Sirius user is linked to an
 * Okta account. If an Okta user already exists for the email, link to it
 * silently (no activation email). Otherwise create the Okta account in the
 * persona's group / user type and trigger Okta's activation email. The Sirius
 * `auth_identities` row is written immediately so the linkage is deterministic
 * regardless of when the user first signs in.
 */
export async function credentialUserInOkta(
  args: CredentialOktaArgs
): Promise<CredentialOktaResult> {
  let issuerUrl: string;
  try {
    issuerUrl = getActiveOktaIssuerUrl();
  } catch (err: any) {
    throw new OktaCredentialingError(
      400,
      err?.message ||
        "Okta is not configured. Set OKTA_ISSUER_URL before credentialing users."
    );
  }
  if (!process.env.OKTA_API_TOKEN) {
    throw new OktaCredentialingError(
      400,
      "OKTA_API_TOKEN is not configured. It is required to create or link Okta users from Sirius."
    );
  }

  const personaCfg = getPersonaConfig(args.persona);
  if (!personaCfg.groupId) {
    const upper = args.persona.toUpperCase();
    const fallbackHint =
      args.persona === "member" ? ` (or its alias OKTA_NEW_USER_GROUP_ID)` : "";
    throw new OktaCredentialingError(
      400,
      `Okta group is not configured for the ${args.persona} persona. Set OKTA_${upper}_GROUP_ID${fallbackHint} so credentialed users land in the correct app group.`
    );
  }

  const user = await storage.users.getUser(args.userId);
  if (!user) {
    throw new OktaCredentialingError(404, "User not found");
  }

  const email = (args.email || "").trim();
  if (!email) {
    throw new OktaCredentialingError(
      400,
      "An email address is required to credential a user in Okta."
    );
  }

  const existingForUser = await storage.authIdentities.getByUserIdAndProvider(
    args.userId,
    "okta"
  );
  if (existingForUser) {
    return {
      outcome: "already_linked",
      oktaUserId: existingForUser.externalId,
      email: existingForUser.email || email,
      message: OUTCOME_MESSAGES.already_linked,
    };
  }

  const firstName = (args.firstName || user.firstName || "").trim();
  const lastName = (args.lastName || user.lastName || "").trim();
  if (!firstName || !lastName) {
    throw new OktaCredentialingError(
      400,
      "First and last name are required to create an Okta account."
    );
  }

  let result;
  try {
    result = await lookupOrCreateOktaUserForPersona({
      issuerUrl,
      persona: args.persona,
      email,
      firstName,
      lastName,
    });
  } catch (err: any) {
    const data = err?.data;
    const status = err?.status;
    logger.error("Okta lookup-or-create failed", {
      userId: args.userId,
      persona: args.persona,
      status,
      error: err?.message,
      data,
    });
    if (status === 401 || status === 403) {
      throw new OktaCredentialingError(
        502,
        "Okta rejected the request. Check that OKTA_API_TOKEN has create-user and group-membership permissions."
      );
    }
    throw new OktaCredentialingError(
      502,
      `Okta request failed: ${err?.message || "unknown error"}`
    );
  }

  const conflict = await storage.authIdentities.getByProviderAndExternalId(
    "okta",
    result.oktaUserId
  );
  if (conflict && conflict.userId !== args.userId) {
    throw new OktaCredentialingError(
      409,
      "This Okta account is already linked to a different Sirius user."
    );
  }

  if (!conflict) {
    await storage.authIdentities.create({
      userId: args.userId,
      providerType: "okta",
      externalId: result.oktaUserId,
      email: result.email,
      displayName: `${firstName} ${lastName}`.trim() || undefined,
    });
  }

  await storage.users.updateUser(args.userId, {
    accountStatus: "linked",
  });

  logger.info("Credentialed Sirius user in Okta", {
    userId: args.userId,
    persona: args.persona,
    outcome: result.outcome,
    oktaUserId: result.oktaUserId,
  });

  return {
    outcome: result.outcome,
    oktaUserId: result.oktaUserId,
    email: result.email,
    message: OUTCOME_MESSAGES[result.outcome],
  };
}
