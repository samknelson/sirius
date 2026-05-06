import { clerkMiddleware, getAuth, createClerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import type { AuthProvider, ClerkProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { parseSSN } from "@shared/utils/ssn";
import { z } from "zod";

function logLoginEvent(user: any, externalId: string, accountLinked: boolean) {
  const userName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.email;

  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entity_id: user.id,
      description: accountLinked
        ? `User logged in (account linked): ${userName}`
        : `User logged in: ${userName}`,
      user_id: user.id,
      user_email: user.email,
      ip_address: context?.ipAddress,
      meta: {
        userId: user.id,
        email: user.email,
        externalId,
        accountLinked,
        provider: "clerk",
      },
    });
  });
}

async function resolveClerkUser(
  clerkUserId: string,
  clerkUserData: {
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }
): Promise<{ allowed: boolean; user?: any }> {
  const { email, firstName, lastName, profileImageUrl } = clerkUserData;

  logger.info("Clerk auth attempt", {
    externalId: clerkUserId,
    email,
    firstName,
    lastName,
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
        const meta = identity.metadata as Record<string, any> | null;
        let linkedWorker = null;
        if (meta?.workerId) {
          linkedWorker = await storage.workers.getWorker(meta.workerId);
        }
        if (!linkedWorker && user.email) {
          linkedWorker = await storage.workers.getWorkerByContactEmail(user.email);
        }
        if (linkedWorker) {
          const contact = await storage.contacts.getContact(linkedWorker.contactId);
          if (contact && contact.email !== email) {
            await storage.contacts.updateEmail(linkedWorker.contactId, email);
            logger.info("Synced updated Clerk email to worker contact on login", {
              workerId: linkedWorker.id,
              previousEmail: contact.email,
              newEmail: email,
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
    logger.info("No provisioned account found for email", { email });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking Clerk account to provisioned user", { userId: user.id });

  let linkedWorkerId: string | null = null;
  if (email) {
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
    metadata: linkedWorkerId ? { workerId: linkedWorkerId } : undefined,
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
          req.logout(() => {});
          if (req.session) {
            (req as any).user = undefined;
          }
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

      const verifyWorkerSchema = z.object({
        firstName: z.string().min(1, "First name is required"),
        lastName: z.string().min(1, "Last name is required"),
        ssn: z.string().min(1, "SSN is required"),
        dateOfBirth: z.string().min(1, "Date of birth is required"),
      });

      app.post("/api/auth/pre-verify-worker", async (req, res) => {
        try {
          if (req.isAuthenticated?.() && req.user) {
            return res.status(400).json({ message: "Already provisioned" });
          }

          const validation = verifyWorkerSchema.safeParse(req.body);
          if (!validation.success) {
            return res.status(400).json({
              message: "Invalid input",
              errors: validation.error.errors.map((e) => e.message),
            });
          }

          const { firstName, lastName, ssn, dateOfBirth } = validation.data;

          let normalizedSSN: string;
          try {
            normalizedSSN = parseSSN(ssn);
          } catch {
            return res.status(400).json({ message: "Invalid SSN format" });
          }

          const worker = await storage.workers.getWorkerBySSN(normalizedSSN);
          if (!worker) {
            logger.info("Worker pre-verification failed: no worker found for SSN");
            return res.status(404).json({
              message: "We could not verify your identity. Please check your information and try again, or contact your administrator.",
            });
          }

          const contact = await storage.contacts.getContact(worker.contactId);
          if (!contact) {
            logger.warn("Worker pre-verification failed: contact not found", {
              workerId: worker.id,
              contactId: worker.contactId,
            });
            return res.status(404).json({
              message: "We could not verify your identity. Please contact your administrator.",
            });
          }

          const fnMatch = (contact.given || "").toLowerCase().trim() === firstName.toLowerCase().trim();
          const lnMatch = (contact.family || "").toLowerCase().trim() === lastName.toLowerCase().trim();
          const dobMatch = contact.birthDate === dateOfBirth;

          if (!fnMatch || !lnMatch || !dobMatch) {
            logger.info("Worker pre-verification failed: field mismatch", {
              workerId: worker.id,
              fnMatch,
              lnMatch,
              dobMatch,
            });
            return res.status(404).json({
              message: "We could not verify your identity. Please check your information and try again, or contact your administrator.",
            });
          }

          const existingIdentities = contact.email
            ? await storage.users.getUserByEmail(contact.email)
            : null;
          if (existingIdentities) {
            const identities = await storage.authIdentities.getByUserId(existingIdentities.id);
            if (identities.some((i) => i.providerType === "clerk")) {
              logger.info("Worker pre-verification blocked: already registered", {
                workerId: worker.id,
              });
              return res.status(409).json({
                message: "This worker already has an account. Please use the Sign In button instead.",
              });
            }
          }

          (req.session as any).verifiedWorker = {
            workerId: worker.id,
            contactId: worker.contactId,
            verifiedAt: Date.now(),
          };

          await new Promise<void>((resolve, reject) => {
            req.session.save((err) => {
              if (err) reject(err);
              else resolve();
            });
          });

          logger.info("Worker pre-verification successful", {
            workerId: worker.id,
          });

          res.json({
            success: true,
            verified: true,
            workerName: `${contact.given || ""} ${contact.family || ""}`.trim(),
          });
        } catch (error) {
          logger.error("Worker pre-verification error", { error });
          res.status(500).json({ message: "An unexpected error occurred. Please try again." });
        }
      });

      app.post("/api/auth/complete-registration", async (req, res) => {
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
            const { firstName: vfn, lastName: vln, ssn: vssn, dateOfBirth: vdob } = req.body || {};
            if (vfn && vln && vssn && vdob) {
              logger.info("Session lost during registration, re-verifying inline", {
                clerkUserId: auth.userId,
              });

              let normalizedSSN: string;
              try {
                normalizedSSN = parseSSN(vssn);
              } catch {
                return res.status(400).json({ message: "Invalid SSN format" });
              }

              const worker = await storage.workers.getWorkerBySSN(normalizedSSN);
              if (worker) {
                const contact = await storage.contacts.getContact(worker.contactId);
                if (contact) {
                  const fnMatch = (contact.given || "").toLowerCase().trim() === vfn.toLowerCase().trim();
                  const lnMatch = (contact.family || "").toLowerCase().trim() === vln.toLowerCase().trim();
                  const dobMatch = contact.birthDate === vdob;

                  if (fnMatch && lnMatch && dobMatch) {
                    verifiedWorker = {
                      workerId: worker.id,
                      contactId: worker.contactId,
                      verifiedAt: Date.now(),
                    };
                    logger.info("Inline re-verification successful", {
                      workerId: worker.id,
                      clerkUserId: auth.userId,
                    });
                  } else {
                    logger.warn("Inline re-verification failed: field mismatch", {
                      clerkUserId: auth.userId,
                      fnMatch,
                      lnMatch,
                      dobMatch,
                    });
                  }
                }
              }
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

          let user = await storage.users.getUserByEmail(primaryEmail || "");

          if (!user && contact.email) {
            user = await storage.users.getUserByEmail(contact.email);
          }

          if (!user) {
            user = await storage.users.createUser({
              email: primaryEmail || contact.email || "",
              firstName: contact.given || clerkUser.firstName || "",
              lastName: contact.family || clerkUser.lastName || "",
              isActive: true,
              accountStatus: "active",
            });
          } else if (!user.isActive) {
            return res.status(403).json({
              message: "Your account has been deactivated. Please contact your administrator.",
            });
          }

          const workerRole = await storage.users.getRoleByName("worker");
          if (workerRole) {
            const currentRoles = await storage.users.getUserRoles(user.id);
            if (!currentRoles.some((r) => r.id === workerRole.id)) {
              await storage.users.assignRoleToUser({
                userId: user.id,
                roleId: workerRole.id,
              });
            }
          }

          const requiredVariable = await storage.variables.getByName("worker_user_roles_required");
          const requiredRoleIds: string[] = (
            Array.isArray(requiredVariable?.value) ? requiredVariable.value : []
          ) as string[];
          const currentRoles = await storage.users.getUserRoles(user.id);
          const currentRoleIds = currentRoles.map((r) => r.id);
          for (const roleId of requiredRoleIds) {
            if (!currentRoleIds.includes(roleId)) {
              await storage.users.assignRoleToUser({ userId: user.id, roleId });
            }
          }

          await storage.authIdentities.create({
            userId: user.id,
            providerType: "clerk",
            externalId: auth.userId,
            email: primaryEmail || contact.email || undefined,
            displayName:
              `${clerkUser.firstName || ""} ${clerkUser.lastName || ""}`.trim() || undefined,
            profileImageUrl: clerkUser.imageUrl || undefined,
            metadata: { workerId: worker.id },
          });

          const linkedUser = await storage.users.updateUser(user.id, {
            email: primaryEmail || contact.email || undefined,
            firstName: contact.given || clerkUser.firstName || "",
            lastName: contact.family || clerkUser.lastName || "",
            profileImageUrl: clerkUser.imageUrl || undefined,
            accountStatus: "linked",
          });

          if (primaryEmail && primaryEmail !== contact.email) {
            try {
              await storage.contacts.updateEmail(worker.contactId, primaryEmail);
              logger.info("Synced Clerk email to worker contact", {
                workerId: worker.id,
                contactId: worker.contactId,
                previousEmail: contact.email || "(none)",
                newEmail: primaryEmail,
              });
            } catch (emailErr) {
              logger.warn("Failed to sync email to worker contact", { error: emailErr });
            }
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

          await storage.users.updateUserLastLogin(user.id);

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
          email?: string;
          firstName?: string;
          lastName?: string;
        } | null = null;

        if (user?.dbUser) {
          logData = {
            userId: user.dbUser.id,
            email: user.dbUser.email,
            firstName: user.dbUser.firstName || undefined,
            lastName: user.dbUser.lastName || undefined,
          };
        }

        req.logout(() => {
          if (logData) {
            setImmediate(() => {
              const name =
                logData!.firstName && logData!.lastName
                  ? `${logData!.firstName} ${logData!.lastName}`
                  : logData!.email;
              const context = getRequestContext();
              storageLogger.info("Authentication event: logout", {
                module: "auth",
                operation: "logout",
                entity_id: logData!.userId,
                description: `User logged out: ${name}`,
                user_id: logData!.userId,
                user_email: logData!.email,
                ip_address: context?.ipAddress,
                meta: {
                  userId: logData!.userId,
                  email: logData!.email,
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
