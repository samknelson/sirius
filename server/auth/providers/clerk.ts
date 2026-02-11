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

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "clerk",
    externalId: clerkUserId,
    email: email,
    displayName: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
    profileImageUrl: profileImageUrl || undefined,
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
          return next();
        }

        try {
          const auth = getAuth(req);

          if (!auth?.userId) {
            return next();
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
          }
        } catch (error) {
          logger.error("Clerk middleware user resolution error", { error });
        }

        return next();
      });

      const verifyWorkerSchema = z.object({
        firstName: z.string().min(1, "First name is required"),
        lastName: z.string().min(1, "Last name is required"),
        ssn: z.string().min(1, "SSN is required"),
        dateOfBirth: z.string().min(1, "Date of birth is required"),
      });

      app.post("/api/auth/verify-worker", async (req, res) => {
        try {
          const auth = getAuth(req);
          if (!auth?.userId) {
            return res.status(401).json({ message: "Not authenticated with Clerk" });
          }

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
            logger.info("Worker verification failed: no worker found for SSN", {
              clerkUserId: auth.userId,
            });
            return res.status(404).json({
              message: "We could not verify your identity. Please check your information and try again, or contact your administrator.",
            });
          }

          const contact = await storage.contacts.getContact(worker.contactId);
          if (!contact) {
            logger.warn("Worker verification failed: contact not found", {
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
            logger.info("Worker verification failed: field mismatch", {
              clerkUserId: auth.userId,
              workerId: worker.id,
              fnMatch,
              lnMatch,
              dobMatch,
            });
            return res.status(404).json({
              message: "We could not verify your identity. Please check your information and try again, or contact your administrator.",
            });
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

          let user = await storage.users.getUserByEmail(primaryEmail || "");

          if (!user && contact.email) {
            user = await storage.users.getUserByEmail(contact.email);
          }

          if (!user) {
            user = await storage.users.createUser({
              email: primaryEmail || contact.email || "",
              firstName: contact.given || firstName,
              lastName: contact.family || lastName,
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
          });

          const linkedUser = await storage.users.updateUser(user.id, {
            email: primaryEmail || contact.email || undefined,
            firstName: contact.given || firstName,
            lastName: contact.family || lastName,
            profileImageUrl: clerkUser.imageUrl || undefined,
            accountStatus: "linked",
          });

          await storage.users.updateUserLastLogin(user.id);

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

          logger.info("Worker self-verification successful", {
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
          logger.error("Worker verification error", { error });
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
