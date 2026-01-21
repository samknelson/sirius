import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";
import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler, Request } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "../storage";
import { storageLogger, logger } from "../logger";
import { getRequestContext } from "../middleware/request-context";

function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
    return ips.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? realIp[0] : realIp;
  }
  return req.socket.remoteAddress || 'unknown';
}

const getOidcConfig = memoize(
  async () => {
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET environment variable is required in production');
    }
    console.warn('WARNING: Using fallback SESSION_SECRET for development. Set SESSION_SECRET in production!');
  }
  
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  const isProduction = process.env.NODE_ENV === 'production';
  
  return session({
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProduction,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function checkUserAccess(
  claims: any,
): Promise<{ allowed: boolean; user?: any; providerType?: string }> {
  const externalId = claims["sub"];
  const email = claims["email"];
  const providerType = "replit" as const;
  
  logger.info("Replit Auth attempt:", {
    source: "auth",
    externalId,
    email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
  });
  
  // 1. Look for existing auth_identity
  const identity = await storage.authIdentities.getByProviderAndExternalId(providerType, externalId);
  
  if (identity) {
    // User exists via identity - verify they're active, update last_used_at
    const user = await storage.users.getUser(identity.userId);
    if (!user?.isActive) {
      logger.warn("User account is inactive:", { source: "auth", userId: identity.userId });
      return { allowed: false };
    }
    
    await storage.authIdentities.updateLastUsed(identity.id);
    
    // Update user profile from claims
    const updatedUser = await storage.users.updateUser(user.id, {
      email: email,
      firstName: claims["first_name"],
      lastName: claims["last_name"],
      profileImageUrl: claims["profile_image_url"],
    });
    
    await storage.users.updateUserLastLogin(user.id);
    
    const userName = updatedUser?.firstName && updatedUser?.lastName
      ? `${updatedUser.firstName} ${updatedUser.lastName}`
      : updatedUser?.email || email;
    
    setImmediate(() => {
      const context = getRequestContext();
      storageLogger.info("Authentication event: login", {
        module: "auth",
        operation: "login",
        entity_id: user.id,
        description: `User logged in: ${userName}`,
        user_id: user.id,
        user_email: email,
        ip_address: context?.ipAddress,
        meta: {
          userId: user.id,
          email,
          providerType,
          externalId,
        },
      });
    });
    
    return { allowed: true, user: updatedUser || user, providerType };
  }
  
  // 2. No identity - try to link by email (for pre-provisioned users)
  const existingUser = await storage.users.getUserByEmail(email);
  
  if (!existingUser) {
    logger.warn("No provisioned account found for email:", { source: "auth", email });
    return { allowed: false };
  }
  
  if (!existingUser.isActive) {
    logger.warn("User account is inactive:", { source: "auth", userId: existingUser.id });
    return { allowed: false };
  }
  
  // Create auth_identity linking this Replit account to existing user
  await storage.authIdentities.create({
    userId: existingUser.id,
    providerType,
    externalId,
    email,
    displayName: `${claims["first_name"] || ""} ${claims["last_name"] || ""}`.trim() || null,
    profileImageUrl: claims["profile_image_url"],
  });
  
  // Update user profile from claims
  const updatedUser = await storage.users.updateUser(existingUser.id, {
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
  
  await storage.users.updateUserLastLogin(existingUser.id);
  
  const userName = updatedUser?.firstName && updatedUser?.lastName
    ? `${updatedUser.firstName} ${updatedUser.lastName}`
    : updatedUser?.email || email;
  
  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entity_id: existingUser.id,
      description: `User logged in (account linked): ${userName}`,
      user_id: existingUser.id,
      user_email: email,
      ip_address: context?.ipAddress,
      meta: {
        userId: existingUser.id,
        email,
        providerType,
        externalId,
        accountLinked: true,
      },
    });
  });
  
  return { allowed: true, user: updatedUser || existingUser, providerType };
}

export async function setupReplitAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Replit OIDC requires REPL_ID environment variable
  if (!process.env.REPL_ID) {
    logger.warn("REPL_ID not set - Replit OIDC auth will not be available. Configure an alternative auth provider for non-Replit environments.", {
      source: "auth",
    });
    
    // Set up minimal passport serialization for session support
    passport.serializeUser((user: Express.User, cb) => cb(null, user));
    passport.deserializeUser((user: Express.User, cb) => cb(null, user));
    
    // Provide stub routes that indicate auth is not configured
    app.get("/api/login", (_req, res) => {
      res.status(503).json({ message: "Authentication not configured. REPL_ID is required for Replit OIDC." });
    });
    app.get("/api/callback", (_req, res) => {
      res.status(503).json({ message: "Authentication not configured." });
    });
    app.get("/api/logout", (_req, res) => {
      res.redirect("/");
    });
    
    return;
  }

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user: any = {};
    updateUserSession(user, tokens);
    
    const accessCheck = await checkUserAccess(tokens.claims());
    
    if (!accessCheck.allowed) {
      return verified(new Error("Access denied. Please contact an administrator to set up your account."), false);
    }
    
    user.dbUser = accessCheck.user;
    user.providerType = accessCheck.providerType || "replit";
    
    verified(null, user);
  };

  const registeredStrategies = new Set<string>();

  const ensureStrategy = (domain: string) => {
    const strategyName = `replitauth:${domain}`;
    if (!registeredStrategies.has(strategyName)) {
      const strategy = new Strategy(
        {
          name: strategyName,
          config,
          scope: "openid email profile offline_access",
          callbackURL: `https://${domain}/api/callback`,
        },
        verify,
      );
      passport.use(strategy);
      registeredStrategies.add(strategyName);
    }
  };

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser(async (user: Express.User, cb) => {
    const sessionUser = user as any;
    if (sessionUser.claims?.sub && !sessionUser.dbUser) {
      try {
        const externalId = sessionUser.claims.sub;
        const providerType = sessionUser.providerType || "replit";
        
        // Look up user via auth_identity
        const identity = await storage.authIdentities.getByProviderAndExternalId(providerType, externalId);
        if (identity) {
          const dbUser = await storage.users.getUser(identity.userId);
          if (dbUser) {
            sessionUser.dbUser = dbUser;
          }
        }
      } catch (error) {
        logger.error('Failed to rehydrate dbUser during deserialization', { error });
      }
    }
    cb(null, user);
  });

  app.get("/api/login", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    ensureStrategy(req.hostname);
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/unauthorized",
    })(req, res, (err: any) => {
      if (err) {
        console.error("Authentication callback error:", err.message);
        return res.redirect("/unauthorized");
      }
      next();
    });
  });

  app.get("/api/logout", async (req, res) => {
    const user = req.user as any;
    const session = req.session as any;
    let logData: { userId?: string; email?: string; firstName?: string; lastName?: string; wasMasquerading?: boolean } | null = null;
    
    if (user?.claims?.sub) {
      try {
        const externalId = user.claims.sub;
        const providerType = user.providerType || "replit";
        const wasMasquerading = !!session.masqueradeUserId;
        
        let dbUser;
        if (session.masqueradeUserId) {
          dbUser = await storage.users.getUser(session.masqueradeUserId);
        } else {
          // Look up user via auth_identity
          const identity = await storage.authIdentities.getByProviderAndExternalId(providerType, externalId);
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
        console.error("Error capturing logout user info:", error);
      }
    }
    
    req.logout(() => {
      if (logData) {
        setImmediate(() => {
          const name = logData!.firstName && logData!.lastName 
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
            },
          });
        });
      }
      
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
