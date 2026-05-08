import { storage } from "../storage";
import { logger } from "../logger";
import {
  createOktaUserAndSendActivation,
  findOktaUsersByEmail,
  getActiveOktaIssuerUrl,
  getPersonaConfig,
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

function wrapOktaError(err: any, userId: string, persona: OktaPersona): OktaCredentialingError {
  const status = err?.status;
  logger.error("Okta admin call failed", {
    userId,
    persona,
    status,
    error: err?.message,
    data: err?.data,
  });
  if (status === 401 || status === 403) {
    return new OktaCredentialingError(
      502,
      "Okta rejected the request. Check that OKTA_API_TOKEN has the required permissions: read users (for lookup), create users, and manage group membership (for activation)."
    );
  }
  return new OktaCredentialingError(
    502,
    `Okta request failed: ${err?.message || "unknown error"}`
  );
}

async function linkAuthIdentity(
  userId: string,
  oktaUserId: string,
  email: string,
  displayName: string | undefined
): Promise<void> {
  const conflict = await storage.authIdentities.getByProviderAndExternalId(
    "okta",
    oktaUserId
  );
  if (conflict && conflict.userId !== userId) {
    throw new OktaCredentialingError(
      409,
      "This Okta account is already linked to a different Sirius user."
    );
  }
  if (!conflict) {
    await storage.authIdentities.create({
      userId,
      providerType: "okta",
      externalId: oktaUserId,
      email,
      displayName: displayName || undefined,
    });
  }
  await storage.users.updateUser(userId, { accountStatus: "linked" });
}

/**
 * Admin-driven credentialing: ensure the given Sirius user is linked to an
 * Okta account.
 *
 * Order matters here: the link-existing path must NOT require create-only
 * preconditions (persona group config, complete first/last name). We therefore:
 *   1. Validate the smallest set of inputs needed to look anything up
 *      (issuer URL, API token, target user, email).
 *   2. Short-circuit if Sirius already has an Okta auth_identity for the user.
 *   3. Look up the Okta user by email — if it exists, link silently with no
 *      activation email and no requirement for persona group config or names.
 *   4. Only when we must CREATE a new Okta user do we require persona group
 *      configuration and first/last name.
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

  // Step 1: already linked in Sirius?
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

  // Step 2: lookup-existing Okta user (no create-only preconditions).
  let matches;
  try {
    matches = await findOktaUsersByEmail(issuerUrl, email);
  } catch (err: any) {
    throw wrapOktaError(err, args.userId, args.persona);
  }

  if (matches.length > 1) {
    const ids = matches.map((m) => `${m.id} (${m.status})`).join(", ");
    logger.warn("Multiple Okta users match email; refusing to credential", {
      userId: args.userId,
      persona: args.persona,
      email,
      matches: matches.map((m) => ({ id: m.id, status: m.status })),
    });
    throw new OktaCredentialingError(
      409,
      `Multiple Okta accounts (${matches.length}) already exist for ${email}: ${ids}. Resolve the duplicates in Okta (delete or merge), then try again.`
    );
  }

  if (matches.length === 1) {
    const existingOktaUser = matches[0];
    const firstName = (args.firstName || user.firstName || "").trim();
    const lastName = (args.lastName || user.lastName || "").trim();
    const displayName = `${firstName} ${lastName}`.trim() || undefined;

    await linkAuthIdentity(
      args.userId,
      existingOktaUser.id,
      existingOktaUser.email,
      displayName
    );

    logger.info("Linked Sirius user to existing Okta account", {
      userId: args.userId,
      persona: args.persona,
      oktaUserId: existingOktaUser.id,
    });

    return {
      outcome: "linked_existing",
      oktaUserId: existingOktaUser.id,
      email: existingOktaUser.email,
      message: OUTCOME_MESSAGES.linked_existing,
    };
  }

  // Step 3: must CREATE a new Okta user — now enforce create-only requirements.
  const personaCfg = getPersonaConfig(args.persona);
  if (!personaCfg.groupId) {
    const upper = args.persona.toUpperCase();
    const fallbackHint =
      args.persona === "member" ? ` (or its alias OKTA_NEW_USER_GROUP_ID)` : "";
    throw new OktaCredentialingError(
      400,
      `Okta group is not configured for the ${args.persona} persona. Set OKTA_${upper}_GROUP_ID${fallbackHint} so newly-created users land in the correct app group.`
    );
  }

  const firstName = (args.firstName || user.firstName || "").trim();
  const lastName = (args.lastName || user.lastName || "").trim();
  if (!firstName || !lastName) {
    throw new OktaCredentialingError(
      400,
      "First and last name are required to create a new Okta account."
    );
  }

  let created;
  try {
    created = await createOktaUserAndSendActivation({
      issuerUrl,
      persona: args.persona,
      email,
      firstName,
      lastName,
    });
  } catch (err: any) {
    throw wrapOktaError(err, args.userId, args.persona);
  }

  await linkAuthIdentity(
    args.userId,
    created.id,
    created.email,
    `${firstName} ${lastName}`.trim()
  );

  logger.info("Created Okta account and linked Sirius user", {
    userId: args.userId,
    persona: args.persona,
    oktaUserId: created.id,
  });

  return {
    outcome: "created_and_activated",
    oktaUserId: created.id,
    email: created.email,
    message: OUTCOME_MESSAGES.created_and_activated,
  };
}
