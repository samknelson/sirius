import * as client from "openid-client";
import {
  Strategy,
  type VerifyFunctionWithRequest,
} from "openid-client/passport";
import passport from "passport";
import type { Express, Request, RequestHandler } from "express";
import memoize from "memoizee";
import type {
  AuthProvider,
  OktaProviderConfig,
  AuthenticatedUser,
} from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import {
  registerPreVerifyWorkerRoute,
  linkWorkerToAuthIdentity,
  isWorkerSelfRegistrationEnabled,
  getVerifiedWorker,
  clearVerifiedWorker,
  clearVerifiedWorkerAndSave,
} from "../worker-provisioning";
import { createOktaUserAndSendActivation } from "../okta-admin";
import {
  getEnvironmentVariable,
  registerEnvironmentVariable,
} from "../../config/env-registry";
import { getPublicBaseUrl } from "../../services/comm/callback-handlers/url-builder";

registerEnvironmentVariable({
  name: "OKTA_CALLBACK_URL",
  description:
    "Explicit fully-qualified Okta OIDC callback URL; overrides the PUBLIC_URL-derived origin.",
  secret: false,
  category: "core",
  changeTakesEffect: "restart",
});

const STRATEGY_NAME = "okta";

const getOidcConfig = memoize(
  async (issuerUrl: string, clientId: string, clientSecret: string) => {
    return await client.discovery(
      new URL(issuerUrl),
      clientId,
      clientSecret
    );
  },
  { maxAge: 3600 * 1000 }
);

function getCanonicalOrigin(): string {
  const explicit = getEnvironmentVariable("OKTA_CALLBACK_URL");
  if (explicit) {
    try {
      const u = new URL(explicit);
      return `${u.protocol}//${u.host}`;
    } catch {
      // fall through
    }
  }
  // PUBLIC_URL is the single base-URL source; its transform already knows the
  // platform-domain fallback chain. getPublicBaseUrl() withholds the localhost
  // development fallback, matching the previous "no host available" throw.
  const base = getPublicBaseUrl();
  if (!base) {
    throw new Error(
      "Okta provider: cannot determine canonical origin. Set OKTA_CALLBACK_URL or PUBLIC_URL (or run on a platform that provides a public domain)."
    );
  }
  const u = new URL(base);
  return `${u.protocol}//${u.host}`;
}

function getCallbackUrl(callbackPath: string): string {
  const explicit = getEnvironmentVariable("OKTA_CALLBACK_URL");
  if (explicit) {
    try {
      const u = new URL(explicit);
      if (u.pathname !== callbackPath) {
        throw new Error(
          `Okta provider: OKTA_CALLBACK_URL path "${u.pathname}" does not match configured callbackPath "${callbackPath}". Set OKTA_CALLBACK_PATH to match, or remove OKTA_CALLBACK_URL.`
        );
      }
      return explicit;
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Okta provider:")) {
        throw err;
      }
      throw new Error(
        `Okta provider: OKTA_CALLBACK_URL is not a valid URL: ${explicit}`
      );
    }
  }
  return `${getCanonicalOrigin()}${callbackPath}`;
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.id_token = (tokens as any).id_token;
  user.expires_at = user.claims?.exp;
  user.providerType = "okta";
}

// getMigratedWorkerId lives in worker-link.ts (shared with the session
// resolver); re-exported here for existing imports.
export { getMigratedWorkerId };

// Migrated accounts (S1 provenance) may ONLY be associated with a worker via
// the recorded migratedWorkerId or the verified-worker (SSN+DOB) session —
// never via contact-email discovery. Shared with /api/auth/user & co.
import {
  isMigratedAccount,
  getMigratedWorkerId,
  reconcileMigrationIdentityLink,
} from "../worker-link";
export { isMigratedAccount };

/** Exported for harness tests (fabricated claims + fake req). */
export async function checkUserAccess(
  claims: any,
  req?: Request
): Promise<{ allowed: boolean; user?: any }> {
  const externalId = claims["sub"];
  const email = claims["email"];
  const firstName =
    claims["given_name"] || claims["first_name"] || undefined;
  const lastName =
    claims["family_name"] || claims["last_name"] || undefined;
  const profileImageUrl =
    claims["picture"] || claims["profile_image_url"] || undefined;

  // PII triage: log only the provider externalId; email/name stay out of logs.
  logger.info("Okta auth attempt", {
    externalId,
  });

  if (!externalId) {
    logger.warn("Okta token missing sub claim");
    return { allowed: false };
  }

  const identity = await storage.authIdentities.getByProviderAndExternalId(
    "okta",
    externalId
  );

  if (identity) {
    const user = await storage.users.getUser(identity.userId);
    if (!user) {
      logger.warn("Okta auth identity found but user missing", {
        identityId: identity.id,
      });
      return { allowed: false };
    }

    if (!user.isActive) {
      logger.info("User account is inactive", { userId: user.id });
      return { allowed: false };
    }

    // T27 reconciliation: a migration-owned identity worker link must match
    // the authoritative recorded link on the user row (shared with the
    // Clerk provider via worker-link.ts).
    if (await reconcileMigrationIdentityLink(identity, user)) {
      logger.warn("Reconciled stale migration-owned identity worker link", {
        identityId: identity.id,
        userId: user.id,
      });
    }

    await storage.authIdentities.update(identity.id, {
      email,
      displayName:
        `${firstName || ""} ${lastName || ""}`.trim() || undefined,
      profileImageUrl,
    });
    await storage.authIdentities.updateLastUsed(identity.id);

    const updatedUser = await storage.users.updateUser(user.id, {
      email,
      firstName,
      lastName,
      profileImageUrl,
    });

    await storage.users.updateUserLastLogin(user.id);

    // Backfill: if an existing Okta identity is not yet tagged with a
    // workerId, persist the link. The migration-recorded worker link
    // (users.data.migratedWorkerId, T27) wins outright; only when absent do
    // we fall back to discovering the worker by IdP email (single match
    // only). This handles users who signed in with Okta before worker
    // self-provisioning existed, admin-created accounts that were later
    // assigned the worker role, and S1-migrated accounts.
    if (
      isWorkerSelfRegistrationEnabled() &&
      email &&
      !(identity.metadata as any)?.workerId
    ) {
      try {
        const migratedWorkerId = getMigratedWorkerId(user);
        // Migrated accounts without a recorded link must NOT be associated
        // with a worker by email discovery — they self-verify via SSN+DOB.
        const matches = migratedWorkerId
          ? await storage.workers
              .getWorker(migratedWorkerId)
              .then((w: any) => (w ? [w] : []))
          : isMigratedAccount(user)
            ? []
            : await storage.workers.getWorkersByContactEmail(email);
        if (matches.length === 1) {
          const worker = matches[0];
          const workerRole = await storage.users.getRoleByName("worker");
          if (workerRole) {
            const currentRoles = await storage.users.getUserRoles(user.id);
            if (!currentRoles.some((r: any) => r.id === workerRole.id)) {
              await storage.users.assignRoleToUser({
                userId: user.id,
                roleId: workerRole.id,
              });
            }
          }
          const requiredVariable = await storage.variables.getByName(
            "worker_user_roles_required"
          );
          const requiredRoleIds: string[] = (
            Array.isArray(requiredVariable?.value)
              ? requiredVariable!.value
              : []
          ) as string[];
          if (requiredRoleIds.length > 0) {
            const currentRoles = await storage.users.getUserRoles(user.id);
            const currentRoleIds = currentRoles.map((r: any) => r.id);
            for (const roleId of requiredRoleIds) {
              if (!currentRoleIds.includes(roleId)) {
                await storage.users.assignRoleToUser({
                  userId: user.id,
                  roleId,
                });
              }
            }
          }
          await storage.authIdentities.update(identity.id, {
            metadata: {
              ...((identity.metadata as any) || {}),
              workerId: worker.id,
            },
          });
          logger.info("Backfilled workerId on existing Okta identity", {
            identityId: identity.id,
            workerId: worker.id,
            userId: user.id,
          });
        } else if (matches.length > 1) {
          logger.warn(
            // PII triage: identify by user/identity ids, not email.
            "Existing-identity worker backfill skipped: multiple workers share contact email",
            { userId: user.id, workerCount: matches.length }
          );
        }
      } catch (err) {
        logger.warn("Existing-identity worker backfill failed", {
          identityId: identity.id,
          error: err,
        });
      }
    }

    logLoginEvent(updatedUser, externalId, false);

    return { allowed: true, user: updatedUser };
  }

  if (!email) {
    logger.info("Okta token missing email; cannot link account", {
      externalId,
    });
    return { allowed: false };
  }

  // Worker self-registration linking paths.
  if (req && isWorkerSelfRegistrationEnabled()) {
    const verified = getVerifiedWorker(req);
    if (verified) {
      try {
        const result = await linkWorkerToAuthIdentity({
          providerType: "okta",
          externalId,
          workerId: verified.workerId,
          email,
          firstName,
          lastName,
          profileImageUrl,
        });
        clearVerifiedWorker(req);
        logger.info("Linked Okta identity to verified worker", {
          workerId: verified.workerId,
          userId: result.user.id,
        });
        logLoginEvent(result.user, externalId, true);
        return { allowed: true, user: result.user };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("deactivated")) {
          logger.info("Okta verified-worker linking blocked: user deactivated", {
            workerId: verified.workerId,
          });
          return { allowed: false };
        }
        logger.error("Okta verified-worker linking failed", {
          workerId: verified.workerId,
          error: err,
        });
        return { allowed: false };
      }
    }

    // Migrated account path (T27): a pre-created S2 user whose loader
    // recorded a deterministic worker link. AUTHORITATIVE and fail-closed:
    // once a recorded link exists, any failure to use it (missing/deleted
    // worker, storage error) DENIES the sign-in for remediation — it must
    // never fall through to the contact-email heuristic, which could attach
    // the identity to a different worker.
    let provisioned: Awaited<ReturnType<typeof storage.users.getUserByEmail>>;
    try {
      provisioned = await storage.users.getUserByEmail(email);
    } catch (err) {
      logger.error("Okta migrated-account lookup failed", {
        externalId,
        error: err,
      });
      return { allowed: false };
    }
    const migratedWorkerId = getMigratedWorkerId(provisioned);
    if (provisioned && migratedWorkerId) {
      if (!provisioned.isActive) {
        logger.info("User account is inactive", { userId: provisioned.id });
        return { allowed: false };
      }
      try {
        const worker = await storage.workers.getWorker(migratedWorkerId);
        if (!worker) {
          logger.error(
            "Okta migrated-account linking denied: recorded worker missing",
            { externalId, userId: provisioned.id, workerId: migratedWorkerId }
          );
          return { allowed: false };
        }
        const result = await linkWorkerToAuthIdentity({
          providerType: "okta",
          externalId,
          workerId: migratedWorkerId,
          email,
          firstName,
          lastName,
          profileImageUrl,
        });
        // Tag the identity as migration-owned so the fast path reconciles
        // it against the recorded link on later logins.
        const created = await storage.authIdentities.getByProviderAndExternalId(
          "okta",
          externalId
        );
        if (created) {
          await storage.authIdentities.update(created.id, {
            metadata: {
              ...((created.metadata as Record<string, unknown> | null) ?? {}),
              source: "s1-user-migration",
            },
          });
        }
        logger.info("Linked Okta identity to migrated worker (T27 pre-link)", {
          workerId: migratedWorkerId,
          userId: result.user.id,
        });
        logLoginEvent(result.user, externalId, true);
        return { allowed: true, user: result.user };
      } catch (err) {
        logger.error("Okta migrated-account linking failed — denying (fail-closed)", {
          externalId,
          userId: provisioned.id,
          workerId: migratedWorkerId,
          error: err,
        });
        return { allowed: false };
      }
    }

    // Migrated account WITHOUT a recorded link (unresolved/ambiguous per the
    // loader's reconciliation): never email-discover a worker for it — the
    // account still links to its own pre-created user below (roles intact,
    // no worker association) and the person attaches a worker only through
    // the SSN+DOB verified path.
    const migratedUnlinked = provisioned != null && isMigratedAccount(provisioned);
    if (migratedUnlinked) {
      logger.info(
        "Okta email-based worker linking skipped: migrated account without recorded link",
        { externalId, userId: provisioned!.id }
      );
    }

    // No verified-worker session — try to discover a worker by contact email.
    // Only link when EXACTLY ONE worker matches; otherwise fall through to
    // the admin email-link path. Multi-match would be ambiguous and could
    // mis-associate the auth identity with the wrong worker.
    if (!migratedUnlinked) try {
      const matchingWorkers =
        await storage.workers.getWorkersByContactEmail(email);
      if (matchingWorkers.length === 0) {
        // PII triage: identify the attempt by provider externalId, not email.
        logger.info("Okta email-based worker linking: no worker match", {
          externalId,
        });
      } else if (matchingWorkers.length > 1) {
        logger.warn(
          "Okta email-based worker linking skipped: multiple workers share contact email",
          {
            // PII triage: externalId + worker ids identify the case, not email.
            externalId,
            workerCount: matchingWorkers.length,
            workerIds: matchingWorkers.map((w) => w.id),
          }
        );
      } else {
        const worker = matchingWorkers[0];
        const result = await linkWorkerToAuthIdentity({
          providerType: "okta",
          externalId,
          workerId: worker.id,
          email,
          firstName,
          lastName,
          profileImageUrl,
        });
        logger.info("Linked Okta identity to worker via contact email match", {
          workerId: worker.id,
          userId: result.user.id,
        });
        logLoginEvent(result.user, externalId, true);
        return { allowed: true, user: result.user };
      }
    } catch (err) {
      // PII triage: identify the attempt by provider externalId, not email.
      logger.error("Okta email-based worker linking failed", {
        externalId,
        error: err,
      });
      // Fall through to admin-email path; do not block.
    }
  }

  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    // PII triage: identify the attempt by provider externalId, not email.
    logger.info("No provisioned account found for Okta email", { externalId });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking Okta account to provisioned user", {
    userId: user.id,
  });

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "okta",
    externalId,
    email,
    displayName:
      `${firstName || ""} ${lastName || ""}`.trim() || undefined,
    profileImageUrl,
  });

  const linkedUser = await storage.users.updateUser(user.id, {
    email,
    firstName,
    lastName,
    profileImageUrl,
    accountStatus: "linked",
  });

  await storage.users.updateUserLastLogin(user.id);
  logLoginEvent(linkedUser, externalId, true);

  return { allowed: true, user: linkedUser };
}

function logLoginEvent(user: any, externalId: string, accountLinked: boolean) {
  // PII triage: audit login events carry userId + provider externalId only;
  // names/emails stay out of routine logs.
  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entity_id: user.id,
      description: accountLinked
        ? "User logged in (account linked)"
        : "User logged in",
      user_id: user.id,
      ip_address: context?.ipAddress,
      meta: {
        userId: user.id,
        externalId,
        accountLinked,
        provider: "okta",
      },
    });
  });
}

export function createProvider(config: OktaProviderConfig): AuthProvider {
  const callbackPath = config.callbackPath || "/api/auth/okta/callback";
  let oidcConfig: Awaited<ReturnType<typeof getOidcConfig>> | null = null;
  let callbackUrl: string = "";

  return {
    type: "okta",

    async setup(app: Express): Promise<void> {
      try {
        oidcConfig = await getOidcConfig(
          config.issuerUrl,
          config.clientId,
          config.clientSecret
        );
      } catch (err) {
        logger.error("Failed to discover Okta OIDC issuer", {
          issuerUrl: config.issuerUrl,
          error: err,
        });
        throw err;
      }

      callbackUrl = getCallbackUrl(callbackPath);

      const verify: VerifyFunctionWithRequest = async (
        req: Request,
        tokens: client.TokenEndpointResponse &
          client.TokenEndpointResponseHelpers,
        verified: passport.AuthenticateCallback
      ) => {
        try {
          const user: any = {};
          updateUserSession(user, tokens);

          const accessCheck = await checkUserAccess(tokens.claims(), req);

          if (!accessCheck.allowed) {
            return verified(
              new Error(
                "Access denied. Please contact an administrator to set up your account."
              ),
              false
            );
          }

          user.dbUser = accessCheck.user;
          verified(null, user);
        } catch (err) {
          logger.error("Okta verify callback error", { error: err });
          verified(err as Error);
        }
      };

      class OktaStrategy extends Strategy {
        authorizationRequestParams(req: any, options: any) {
          const base = super.authorizationRequestParams(req, options);
          const params =
            base instanceof URLSearchParams
              ? base
              : new URLSearchParams(base as Record<string, string> | undefined);
          if (!params.has("state")) {
            params.set("state", client.randomState());
          }
          return params;
        }
      }

      const strategy = new OktaStrategy(
        {
          name: STRATEGY_NAME,
          config: oidcConfig,
          scope: "openid email profile offline_access",
          callbackURL: callbackUrl,
          passReqToCallback: true,
        },
        verify
      );

      passport.use(strategy);

      registerPreVerifyWorkerRoute(app, { providerType: "okta" });

      app.post("/api/auth/complete-registration", async (req, res) => {
        if (!isWorkerSelfRegistrationEnabled()) {
          return res.status(403).json({
            message:
              "Worker self-registration is not enabled. Please contact your administrator.",
          });
        }
        try {
          logger.info("Okta worker registration: complete-registration called", {
            hasVerifiedWorker: !!getVerifiedWorker(req),
          });
          const verified = getVerifiedWorker(req);
          if (!verified) {
            return res.status(400).json({
              message:
                "Your verification has expired. Please verify your identity again.",
            });
          }

          const worker = await storage.workers.getWorker(verified.workerId);
          if (!worker) {
            return res.status(404).json({ message: "Worker record not found." });
          }

          const contact = await storage.contacts.getContact(worker.contactId);
          if (!contact) {
            return res.status(404).json({ message: "Contact record not found." });
          }

          const requestedEmail = (req.body?.email || "").toString().trim();
          const contactEmail = (contact.email || "").trim();
          const email = requestedEmail || contactEmail;
          if (!email) {
            return res.status(400).json({
              message:
                "An email address is required. Please enter the email you'd like to use for your Okta account.",
            });
          }

          const firstName = contact.given || "";
          const lastName = contact.family || "";
          if (!firstName || !lastName) {
            return res.status(400).json({
              message:
                "Worker name is incomplete on file. Please contact your administrator.",
            });
          }

          if (
            requestedEmail &&
            requestedEmail.toLowerCase() !== contactEmail.toLowerCase()
          ) {
            try {
              await storage.contacts.updateEmail(worker.contactId, requestedEmail);
              logger.info(
                "Updated worker contact email to match Okta registration email",
                {
                  workerId: worker.id,
                  contactId: worker.contactId,
                }
              );
            } catch (err) {
              logger.warn(
                "Failed to update contact email before Okta user creation",
                { workerId: worker.id, error: err }
              );
            }
          }

          let created;
          try {
            created = await createOktaUserAndSendActivation({
              issuerUrl: config.issuerUrl,
              persona: "member",
              email,
              firstName,
              lastName,
            });
          } catch (err: any) {
            const data = err?.data;
            const errorCode =
              data && typeof data === "object" ? data.errorCode : undefined;
            // E0000001 = "Api validation failed" — typically duplicate login.
            if (
              errorCode === "E0000001" ||
              (typeof data === "object" &&
                JSON.stringify(data?.errorCauses || []).includes(
                  "already exists"
                ))
            ) {
              return res.status(409).json({
                message:
                  "An Okta account already exists for this email. Please use Sign In instead, or contact your administrator.",
              });
            }
            logger.error("Okta user creation failed", {
              workerId: worker.id,
              status: err?.status,
              error: err?.message,
              data,
            });
            return res.status(500).json({
              message:
                "Failed to create your Okta account. Please try again or contact your administrator.",
            });
          }

          await clearVerifiedWorkerAndSave(req);

          logger.info(
            "Created Okta user for worker; activation email dispatched by Okta",
            {
              // PII triage: workerId + oktaUserId identify the account, not email.
              workerId: worker.id,
              oktaUserId: created.id,
            }
          );

          res.json({
            success: true,
            activationEmailSent: true,
            email: created.email,
          });
        } catch (error) {
          logger.error("Okta worker registration completion error", { error });
          res
            .status(500)
            .json({ message: "An unexpected error occurred. Please try again." });
        }
      });

      app.get(callbackPath, (req, res, next) => {
        if (req.query.error) {
          logger.error("Okta returned error on callback", {
            error: req.query.error,
            error_description: req.query.error_description,
          });
          const params = new URLSearchParams({
            provider: "okta",
            error: String(req.query.error),
            ...(req.query.error_description
              ? { description: String(req.query.error_description) }
              : {}),
          });
          return res.redirect(`/login?${params.toString()}`);
        }
        passport.authenticate(STRATEGY_NAME, {
          successReturnToOrRedirect: "/",
          failureRedirect: "/login?provider=okta&error=okta_failed",
        })(req, res, (err: any) => {
          if (err) {
            logger.error("Okta callback error", {
              error: err?.message,
              code: err?.code,
            });
            const params = new URLSearchParams({
              provider: "okta",
              error: "okta_callback_failed",
              description: err?.message || "Authentication failed",
            });
            return res.redirect(`/login?${params.toString()}`);
          }
          next();
        });
      });

      logger.info("Okta auth provider initialized", {
        issuerUrl: config.issuerUrl,
        callbackUrl,
      });
    },

    getLoginHandler(): RequestHandler {
      return (req, res, next) => {
        passport.authenticate(STRATEGY_NAME, {
          scope: ["openid", "email", "profile", "offline_access"],
          prompt: "login",
        } as any)(req, res, next);
      };
    },

    getCallbackHandler(): RequestHandler {
      return (req, res, next) => {
        passport.authenticate(STRATEGY_NAME, {
          successReturnToOrRedirect: "/",
          failureRedirect: "/auth-error?error=okta_failed",
        })(req, res, (err: any) => {
          if (err) {
            logger.error("Okta callback error", { error: err?.message });
            return res.redirect("/auth-error?error=okta_callback_failed");
          }
          next();
        });
      };
    },

    getLogoutHandler(): RequestHandler {
      return async (req, res) => {
        const user = req.user as AuthenticatedUser | undefined;
        const session = req.session as any;
        let logData: {
          userId?: string;
          wasMasquerading?: boolean;
        } | null = null;
        const idToken = (user as any)?.id_token;

        if (user?.claims?.sub) {
          try {
            const externalId = user.claims.sub;
            const wasMasquerading = !!session?.masqueradeUserId;

            let dbUser = user.dbUser;
            if (session?.masqueradeUserId) {
              dbUser = await storage.users.getUser(session.masqueradeUserId);
            } else if (!dbUser) {
              const identity =
                await storage.authIdentities.getByProviderAndExternalId(
                  "okta",
                  externalId
                );
              if (identity) {
                dbUser = await storage.users.getUser(identity.userId);
              }
            }

            if (dbUser) {
              logData = {
                userId: dbUser.id,
                wasMasquerading,
              };
            }
          } catch (error) {
            logger.error("Error capturing Okta logout user info", { error });
          }
        }

        req.logout(() => {
          if (logData) {
            setImmediate(() => {
              // PII triage: audit logout events carry userId only.
              const context = getRequestContext();
              storageLogger.info("Authentication event: logout", {
                module: "auth",
                operation: "logout",
                entity_id: logData!.userId,
                description: "User logged out",
                user_id: logData!.userId,
                ip_address: context?.ipAddress,
                meta: {
                  userId: logData!.userId,
                  wasMasquerading: logData!.wasMasquerading,
                  provider: "okta",
                },
              });
            });
          }

          const destroy = () => {
            if (req.session) {
              req.session.destroy(() => {
                redirectAfterLogout();
              });
            } else {
              redirectAfterLogout();
            }
          };

          const redirectAfterLogout = () => {
            if (oidcConfig) {
              try {
                const postLogoutRedirectUri = getCanonicalOrigin();
                const endSessionUrl = client.buildEndSessionUrl(oidcConfig, {
                  client_id: config.clientId,
                  post_logout_redirect_uri: postLogoutRedirectUri,
                  ...(idToken ? { id_token_hint: idToken } : {}),
                });
                return res.redirect(endSessionUrl.href);
              } catch (err) {
                logger.warn(
                  "Okta end-session URL build failed; redirecting locally",
                  { error: err }
                );
              }
            }
            res.redirect("/");
          };

          destroy();
        });
      };
    },

    async refreshToken(
      user: AuthenticatedUser
    ): Promise<AuthenticatedUser | null> {
      if (!user.refresh_token || !oidcConfig) {
        return null;
      }
      try {
        const tokenResponse = await client.refreshTokenGrant(
          oidcConfig,
          user.refresh_token
        );
        return {
          ...user,
          claims: tokenResponse.claims() as AuthenticatedUser["claims"],
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token || user.refresh_token,
          expires_at: tokenResponse.claims()?.exp,
        };
      } catch (error) {
        logger.error("Failed to refresh Okta token", { error });
        return null;
      }
    },
  };
}
