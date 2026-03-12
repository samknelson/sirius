import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import type { Express, RequestHandler, Request } from "express";
import memoize from "memoizee";
import type { AuthProvider, ReplitProviderConfig, AuthenticatedUser, AuthIdentityInfo } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";

const getOidcConfig = memoize(
  async (issuerUrl: string, clientId: string) => {
    return await client.discovery(new URL(issuerUrl), clientId);
  },
  { maxAge: 3600 * 1000 }
);

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
  user.providerType = "replit";
}

async function checkUserAccess(
  claims: any
): Promise<{ allowed: boolean; user?: any }> {
  const externalId = claims["sub"];
  const email = claims["email"];

  logger.info("Replit Auth attempt", {
    externalId: externalId,
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
  });

  let identity = await storage.authIdentities.getByProviderAndExternalId("replit", externalId);

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
      displayName: `${claims["first_name"] || ""} ${claims["last_name"] || ""}`.trim() || undefined,
      profileImageUrl: claims["profile_image_url"],
    });
    await storage.authIdentities.updateLastUsed(identity.id);

    const updatedUser = await storage.users.updateUser(user.id, {
      email: email,
      firstName: claims["first_name"],
      lastName: claims["last_name"],
      profileImageUrl: claims["profile_image_url"],
    });

    await storage.users.updateUserLastLogin(user.id);

    logLoginEvent(updatedUser, externalId, false);

    return { allowed: true, user: updatedUser };
  }

  // No auth identity found - try to find user by email and link account
  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    logger.info("No provisioned account found for email", { email });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking Replit account to provisioned user", { userId: user.id });

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "replit",
    externalId: externalId,
    email: email,
    displayName: `${claims["first_name"] || ""} ${claims["last_name"] || ""}`.trim() || undefined,
    profileImageUrl: claims["profile_image_url"],
  });

  const linkedUser = await storage.users.updateUser(user.id, {
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
    accountStatus: 'linked',
  });

  await storage.users.updateUserLastLogin(user.id);
  logLoginEvent(linkedUser, externalId, true);

  return { allowed: true, user: linkedUser };
}

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
        externalId: externalId,
        accountLinked,
        provider: "replit",
      },
    });
  });
}

export function createProvider(config: ReplitProviderConfig): AuthProvider {
  const issuerUrl = config.issuerUrl || process.env.ISSUER_URL || "https://replit.com/oidc";
  const clientId = config.clientId || process.env.REPL_ID!;
  const registeredStrategies = new Set<string>();

  let oidcConfig: Awaited<ReturnType<typeof getOidcConfig>> | null = null;

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName) && oidcConfig) {
      const verify: VerifyFunction = async (
        tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
        verified: passport.AuthenticateCallback
      ) => {
        const user: any = {};
        updateUserSession(user, tokens);

        const accessCheck = await checkUserAccess(tokens.claims());

        if (!accessCheck.allowed) {
          return verified(
            new Error("Access denied. Please contact an administrator to set up your account."),
            false
          );
        }

        user.dbUser = accessCheck.user;
        verified(null, user);
      };

      const strategy = new Strategy(
        {
          name: strategyName,
          config: oidcConfig,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  return {
    type: "replit",

    async setup(app: Express): Promise<void> {
      oidcConfig = await getOidcConfig(issuerUrl, clientId);
      logger.info("Replit auth provider initialized");
    },

    getLoginHandler(): RequestHandler {
      return (req, res, next) => {
        ensureStrategy(req.hostname);
        passport.authenticate(`replitauth:${req.hostname}`, {
          prompt: "login consent",
          scope: ["openid", "email", "profile", "offline_access"],
        })(req, res, next);
      };
    },

    getCallbackHandler(): RequestHandler {
      return (req, res, next) => {
        ensureStrategy(req.hostname);
        passport.authenticate(`replitauth:${req.hostname}`, {
          successReturnToOrRedirect: "/",
          failureRedirect: "/unauthorized",
        })(req, res, (err: any) => {
          if (err) {
            logger.error("Authentication callback error", { error: err.message });
            return res.redirect("/unauthorized");
          }
          next();
        });
      };
    },

    getLogoutHandler(): RequestHandler {
      return async (req, res) => {
        const user = req.user as any;
        const session = req.session as any;
        let logData: {
          userId?: string;
          email?: string;
          firstName?: string;
          lastName?: string;
          wasMasquerading?: boolean;
        } | null = null;

        if (user?.claims?.sub) {
          try {
            const externalId = user.claims.sub;
            const wasMasquerading = !!session.masqueradeUserId;

            let dbUser = user.dbUser;
            if (session.masqueradeUserId) {
              dbUser = await storage.users.getUser(session.masqueradeUserId);
            } else if (!dbUser) {
              // Fallback: look up via auth_identities
              const identity = await storage.authIdentities.getByProviderAndExternalId("replit", externalId);
              if (identity) {
                dbUser = await storage.users.getUser(identity.userId);
              }
            }

            if (dbUser) {
              logData = {
                userId: dbUser.id,
                email: dbUser.email,
                firstName: dbUser.firstName || undefined,
                lastName: dbUser.lastName || undefined,
                wasMasquerading,
              };
            }
          } catch (error) {
            logger.error("Error capturing logout user info", { error });
          }
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
                  wasMasquerading: logData!.wasMasquerading,
                  provider: "replit",
                },
              });
            });
          }

          if (oidcConfig) {
            res.redirect(
              client.buildEndSessionUrl(oidcConfig, {
                client_id: clientId,
                post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
              }).href
            );
          } else {
            res.redirect("/");
          }
        });
      };
    },

    async refreshToken(user: AuthenticatedUser): Promise<AuthenticatedUser | null> {
      if (!user.refresh_token || !oidcConfig) {
        return null;
      }

      try {
        const tokenResponse = await client.refreshTokenGrant(oidcConfig, user.refresh_token);
        const refreshedUser: AuthenticatedUser = {
          ...user,
          claims: tokenResponse.claims() as AuthenticatedUser["claims"],
          access_token: tokenResponse.access_token,
          refresh_token: tokenResponse.refresh_token || user.refresh_token,
          expires_at: tokenResponse.claims()?.exp,
        };
        return refreshedUser;
      } catch (error) {
        logger.error("Failed to refresh Replit token", { error });
        return null;
      }
    },
  };
}
