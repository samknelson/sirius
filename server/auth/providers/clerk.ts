import { clerkMiddleware, getAuth, createClerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import type { AuthProvider, ClerkProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { verifyWorkerIdentity } from "../identity-verification";
import {
  registerPreVerifyWorkerRoute,
  linkWorkerToAuthIdentity,
  isWorkerSelfRegistrationEnabled,
} from "../worker-provisioning";
import {
  isMigratedAccount,
  getMigratedWorkerId,
  resolveLinkedWorkerId,
  reconcileMigrationIdentityLink,
} from "../worker-link";

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
        provider: "clerk",
      },
    });
  });
}

// Exported for the T27 first-login smoke harness (fabricated identities);
// runtime callers stay inside this module.
export async function resolveClerkUser(
  clerkUserId: string,
  clerkUserData: {
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }
): Promise<{ allowed: boolean; user?: any }> {
  const { email, firstName, lastName, profileImageUrl } = clerkUserData;

  // PII triage: log only the provider externalId; email/name stay out of logs.
  logger.info("Clerk auth attempt", {
    externalId: clerkUserId,
  });

  let identity = await storage.authIdentities.getByProviderAndExternalId("clerk", clerkUserId);

  if (identity) {
    const user = await storage.users.getUser(identity.userId);
    if (!user) {
      logger.warn("Auth identity found but user missing", { identityId: identity.id });
      return { allowed: false };
    }

    if (!user.isActive) {
      logger.info("User account is inactive", { userId: user.id });
      return { allowed: false };
    }

    // T27 reconciliation: a migration-owned identity worker link must match
    // the authoritative recorded link on the user row (shared with the Okta
    // provider via worker-link.ts).
    if (await reconcileMigrationIdentityLink(identity, user)) {
      logger.warn("Reconciled stale migration-owned identity worker link", {
        identityId: identity.id,
        userId: user.id,
      });
    }

    await storage.authIdentities.update(identity.id, {
      email: email,
      displayName: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
      profileImageUrl: profileImageUrl || undefined,
    });
    await storage.authIdentities.updateLastUsed(identity.id);

    const updatedUser = await storage.users.updateUser(user.id, {
      email: email,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      profileImageUrl: profileImageUrl || undefined,
    });

    if (email && email !== user.email) {
      try {
        // Shared resolver: validated identity metadata first; email fallback
        // is prohibited for migrated (S1-provenance) accounts, so a stale
        // migration link can never redirect the sync to the wrong worker.
        const resolvedWorkerId = await resolveLinkedWorkerId(user);
        const linkedWorker = resolvedWorkerId
          ? await storage.workers.getWorker(resolvedWorkerId)
          : null;
        if (linkedWorker) {
          const contact = await storage.contacts.getContact(linkedWorker.contactId);
          if (contact && contact.email !== email) {
            await storage.contacts.updateEmail(linkedWorker.contactId, email);
            // PII triage: ids identify the rows; the emails themselves stay out of logs.
            logger.info("Synced updated Clerk email to worker contact on login", {
              workerId: linkedWorker.id,
              contactId: linkedWorker.contactId,
            });
          }
        }
      } catch (syncErr) {
        logger.warn("Failed to sync email to worker contact on login", { error: syncErr });
      }
    }

    await storage.users.updateUserLastLogin(user.id);
    logLoginEvent(updatedUser, clerkUserId, false);

    return { allowed: true, user: updatedUser };
  }

  if (!email) {
    logger.info("No email available from Clerk user", { clerkUserId });
    return { allowed: false };
  }

  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    // PII triage: identify the attempt by provider externalId, not email.
    logger.info("No provisioned account found for email", { clerkUserId });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking Clerk account to provisioned user", { userId: user.id });

  let linkedWorkerId: string | null = null;
  let migrationOwnedLink = false;
  if (isMigratedAccount(user)) {
    // T27: migrated accounts NEVER email-discover a worker. Only the
    // loader-recorded deterministic link may associate a worker, and it must
    // resolve — a recorded link to a missing worker fails closed.
    const recorded = getMigratedWorkerId(user);
    if (recorded) {
      let worker = null;
      try {
        worker = await storage.workers.getWorker(recorded);
      } catch (err) {
        logger.error("Recorded migration worker lookup failed; denying login", {
          userId: user.id,
          workerId: recorded,
          error: err,
        });
        return { allowed: false };
      }
      if (!worker) {
        logger.error("Recorded migration worker missing; denying login", {
          userId: user.id,
          workerId: recorded,
        });
        return { allowed: false };
      }
      linkedWorkerId = recorded;
      migrationOwnedLink = true;
    }
    // else: unlinked migrated account — links WITHOUT worker association;
    // SSN+DOB self-verification remains the only way to attach a worker.
  } else if (email) {
    const worker = await storage.workers.getWorkerByContactEmail(email);
    if (worker) {
      linkedWorkerId = worker.id;
    }
  }

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "clerk",
    externalId: clerkUserId,
    email: email,
    displayName: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
    profileImageUrl: profileImageUrl || undefined,
    metadata: linkedWorkerId
      ? migrationOwnedLink
        ? { workerId: linkedWorkerId, source: "s1-user-migration" }
        : { workerId: linkedWorkerId }
      : undefined,
  });

  const linkedUser = await storage.users.updateUser(user.id, {
    email: email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    profileImageUrl: profileImageUrl || undefined,
    accountStatus: "linked",
  });

  await storage.users.updateUserLastLogin(user.id);
  logLoginEvent(linkedUser, clerkUserId, true);

  return { allowed: true, user: linkedUser };
}

export function createProvider(config: ClerkProviderConfig): AuthProvider {
  const unlinkedUserCache = new Map<string, number>();
  const UNLINKED_CACHE_TTL = 60 * 1000;

  return {
    type: "clerk",

    async setup(app: Express): Promise<void> {
      app.use(
        clerkMiddleware({
          publishableKey: config.publishableKey,
          secretKey: config.secretKey,
        })
      );

      app.use(async (req, _res, next) => {
        if (req.isAuthenticated?.() && req.user) {
          const existingUser = req.user as AuthenticatedUser;
          if (!existingUser.expires_at || Math.floor(Date.now() / 1000) <= existingUser.expires_at) {
            return next();
          }
          logger.debug("Clearing expired session before Clerk re-auth", {
            providerType: existingUser.providerType,
          });
          // Await logout so the session regeneration / Set-Cookie completes
          // before any downstream middleware writes the response. Otherwise the
          // async Set-Cookie races with res.sendFile() and triggers
          // ERR_HTTP_HEADERS_SENT, surfacing as a white "Internal Server Error"
          // page on session expiry.
          await new Promise<void>((resolve) => {
            try {
              req.logout((err) => {
                if (err) {
                  logger.warn("Logout during expired-session refresh failed", { error: err });
                }
                resolve();
              });
            } catch (err) {
              logger.warn("Logout during expired-session refresh threw", { error: err });
              resolve();
            }
          });
          (req as any).user = undefined;
        }

        try {
          const auth = getAuth(req);

          if (!auth?.userId) {
            return next();
          }

          const cachedAt = unlinkedUserCache.get(auth.userId);
          if (cachedAt && Date.now() - cachedAt < UNLINKED_CACHE_TTL) {
            return next();
          }

          const identity = await storage.authIdentities.getByProviderAndExternalId("clerk", auth.userId);

          if (identity) {
            const user = await storage.users.getUser(identity.userId);
            if (user && user.isActive) {
              // T27: strip stale migration-owned worker links before the
              // session is (re-)established.
              await reconcileMigrationIdentityLink(identity, user);
              await storage.authIdentities.updateLastUsed(identity.id);
              await storage.users.updateUserLastLogin(user.id);

              const sessionUser: AuthenticatedUser = {
                claims: {
                  sub: auth.userId,
                  email: user.email || undefined,
                  first_name: user.firstName || undefined,
                  last_name: user.lastName || undefined,
                  profile_image_url: user.profileImageUrl || undefined,
                },
                providerType: "clerk",
                dbUser: user,
              };

              await new Promise<void>((resolve, reject) => {
                req.login(sessionUser, (err) => {
                  if (err) reject(err);
                  else resolve();
                });
              });

              unlinkedUserCache.delete(auth.userId);
              return next();
            }
          }

          const client = createClerkClient({ secretKey: config.secretKey, publishableKey: config.publishableKey });
          const clerkUser = await client.users.getUser(auth.userId);

          const primaryEmail = clerkUser.emailAddresses?.find(
            (e: any) => e.id === clerkUser.primaryEmailAddressId
          )?.emailAddress;

          const result = await resolveClerkUser(auth.userId, {
            email: primaryEmail,
            firstName: clerkUser.firstName,
            lastName: clerkUser.lastName,
            profileImageUrl: clerkUser.imageUrl,
          });

          if (result.allowed && result.user) {
            unlinkedUserCache.delete(auth.userId);

            const sessionUser: AuthenticatedUser = {
              claims: {
                sub: auth.userId,
                email: primaryEmail,
                first_name: clerkUser.firstName || undefined,
                last_name: clerkUser.lastName || undefined,
                profile_image_url: clerkUser.imageUrl || undefined,
              },
              providerType: "clerk",
              dbUser: result.user,
            };

            await new Promise<void>((resolve, reject) => {
              req.login(sessionUser, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          } else {
            unlinkedUserCache.set(auth.userId, Date.now());
          }
        } catch (error) {
          try {
            const auth = getAuth(req);
            if (auth?.userId) {
              unlinkedUserCache.set(auth.userId, Date.now());
            }
          } catch {}
          logger.error("Clerk middleware user resolution error", { error });
        }

        if (!_res.headersSent) {
          return next();
        }
      });

      registerPreVerifyWorkerRoute(app, { providerType: "clerk" });

      app.post("/api/auth/complete-registration", async (req, res) => {
        if (!isWorkerSelfRegistrationEnabled()) {
          return res.status(403).json({
            message: "Worker self-registration is not enabled. Please contact your administrator.",
          });
        }
        try {
          const auth = getAuth(req);
          if (!auth?.userId) {
            return res.status(401).json({ message: "Please sign up with Clerk first" });
          }

          const existingIdentity = await storage.authIdentities.getByProviderAndExternalId("clerk", auth.userId);
          if (existingIdentity) {
            const existingUser = await storage.users.getUser(existingIdentity.userId);
            if (existingUser && existingUser.isActive) {
              if (!req.isAuthenticated?.() || !req.user) {
                const sessionUser: AuthenticatedUser = {
                  claims: {
                    sub: auth.userId,
                    email: existingUser.email || undefined,
                    first_name: existingUser.firstName || undefined,
                    last_name: existingUser.lastName || undefined,
                    profile_image_url: existingUser.profileImageUrl || undefined,
                  },
                  providerType: "clerk",
                  dbUser: existingUser,
                };
                await new Promise<void>((resolve, reject) => {
                  req.login(sessionUser, (err) => {
                    if (err) reject(err);
                    else resolve();
                  });
                });
              }
              delete (req.session as any).verifiedWorker;
              return res.json({
                success: true,
                user: {
                  id: existingUser.id,
                  email: existingUser.email,
                  firstName: existingUser.firstName,
                  lastName: existingUser.lastName,
                },
              });
            }
          }

          let verifiedWorker = (req.session as any).verifiedWorker;

          if (!verifiedWorker || !verifiedWorker.workerId) {
            logger.info("Session lost during registration, re-verifying inline", {
              clerkUserId: auth.userId,
            });

            const result = await verifyWorkerIdentity(req.body);

            if (result.status === "invalid_ssn") {
              return res.status(400).json({ message: "Invalid SSN format" });
            }

            if (result.status === "verified") {
              verifiedWorker = {
                workerId: result.workerId,
                contactId: result.contactId,
                verifiedAt: Date.now(),
              };
              logger.info("Inline re-verification successful", {
                workerId: result.workerId,
                clerkUserId: auth.userId,
              });
            } else if (result.status === "field_mismatch") {
              logger.warn("Inline re-verification failed: field mismatch", {
                clerkUserId: auth.userId,
                fnMatch: result.fnMatch,
                lnMatch: result.lnMatch,
                dobMatch: result.dobMatch,
              });
            }
          }

          if (!verifiedWorker || !verifiedWorker.workerId) {
            return res.status(400).json({
              message: "No verified identity found. Please complete identity verification first.",
            });
          }

          const elapsed = Date.now() - (verifiedWorker.verifiedAt || 0);
          if (elapsed > 30 * 60 * 1000) {
            delete (req.session as any).verifiedWorker;
            return res.status(400).json({
              message: "Your verification has expired. Please verify your identity again.",
            });
          }

          const worker = await storage.workers.getWorker(verifiedWorker.workerId);
          if (!worker) {
            return res.status(404).json({ message: "Worker record not found." });
          }

          const contact = await storage.contacts.getContact(worker.contactId);
          if (!contact) {
            return res.status(404).json({ message: "Contact record not found." });
          }

          const client = createClerkClient({
            secretKey: config.secretKey,
            publishableKey: config.publishableKey,
          });
          const clerkUser = await client.users.getUser(auth.userId);
          const primaryEmail =
            clerkUser.emailAddresses?.find(
              (e: any) => e.id === clerkUser.primaryEmailAddressId
            )?.emailAddress || contact.email;

          const primaryPhone =
            clerkUser.phoneNumbers?.find(
              (p: any) => p.id === clerkUser.primaryPhoneNumberId
            )?.phoneNumber;

          let linkedUser: any;
          let user: any;
          try {
            const linkResult = await linkWorkerToAuthIdentity({
              providerType: "clerk",
              externalId: auth.userId,
              workerId: worker.id,
              email: primaryEmail || contact.email || undefined,
              firstName: clerkUser.firstName || undefined,
              lastName: clerkUser.lastName || undefined,
              profileImageUrl: clerkUser.imageUrl || undefined,
            });
            linkedUser = linkResult.user;
            user = linkResult.user;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message.includes("deactivated")) {
              return res.status(403).json({
                message: "Your account has been deactivated. Please contact your administrator.",
              });
            }
            logger.error("Worker registration linking failed", { error: err });
            return res.status(500).json({ message: "An unexpected error occurred. Please try again." });
          }

          if (primaryPhone) {
            try {
              const existingPhones = await storage.contacts.phoneNumbers.getPhoneNumbersByContact(worker.contactId);
              const alreadyExists = existingPhones.some(
                (p) => p.phoneNumber.replace(/\D/g, "") === primaryPhone.replace(/\D/g, "")
              );
              if (!alreadyExists) {
                await storage.contacts.phoneNumbers.createPhoneNumber({
                  contactId: worker.contactId,
                  phoneNumber: primaryPhone,
                  friendlyName: "Mobile",
                  isPrimary: existingPhones.length === 0,
                  isActive: true,
                });
                logger.info("Synced Clerk phone to worker contact", {
                  workerId: worker.id,
                  contactId: worker.contactId,
                });
              }
            } catch (phoneErr) {
              logger.warn("Failed to sync phone to worker contact", { error: phoneErr });
            }
          }

          delete (req.session as any).verifiedWorker;
          unlinkedUserCache.delete(auth.userId);

          const sessionUser: AuthenticatedUser = {
            claims: {
              sub: auth.userId,
              email: primaryEmail || undefined,
              first_name: clerkUser.firstName || undefined,
              last_name: clerkUser.lastName || undefined,
              profile_image_url: clerkUser.imageUrl || undefined,
            },
            providerType: "clerk",
            dbUser: linkedUser,
          };

          await new Promise<void>((resolve, reject) => {
            req.login(sessionUser, (err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          logLoginEvent(linkedUser, auth.userId, true);

          logger.info("Worker registration completed", {
            workerId: worker.id,
            userId: user.id,
            clerkUserId: auth.userId,
          });

          res.json({
            success: true,
            user: {
              id: linkedUser?.id || user.id,
              email: linkedUser?.email || user.email,
              firstName: linkedUser?.firstName || user.firstName,
              lastName: linkedUser?.lastName || user.lastName,
            },
          });
        } catch (error) {
          logger.error("Worker registration completion error", { error });
          res.status(500).json({ message: "An unexpected error occurred. Please try again." });
        }
      });

      logger.info("Clerk auth provider initialized");
    },

    getLoginHandler(): RequestHandler {
      return (_req, res) => {
        res.redirect("/");
      };
    },

    getCallbackHandler(): RequestHandler {
      return (_req, res) => {
        res.redirect("/");
      };
    },

    getLogoutHandler(): RequestHandler {
      return async (req, res) => {
        const user = req.user as AuthenticatedUser | undefined;
        let logData: {
          userId?: string;
        } | null = null;

        if (user?.dbUser) {
          logData = {
            userId: user.dbUser.id,
          };
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
                  provider: "clerk",
                },
              });
            });
          }

          res.redirect("/");
        });
      };
    },
  };
}
