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
import { isMockAuthEnabled } from "./currentUser";

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
): Promise<{ allowed: boolean; user?: any }> {
  const replitUserId = claims["sub"];
  const email = claims["email"];
  
  console.log("Replit Auth attempt:", {
    replitId: replitUserId,
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
  });
  
  let user = await storage.users.getUserByReplitId(replitUserId);
  
  if (user) {
    console.log("Found existing linked account:", user.id);
    
    if (!user.isActive) {
      console.log("User account is inactive:", user.id);
      return { allowed: false };
    }
    
    const updatedUser = await storage.users.updateUser(user.id, {
      email: email,
      firstName: claims["first_name"],
      lastName: claims["last_name"],
      profileImageUrl: claims["profile_image_url"],
    });
    
    if (!updatedUser) {
      return { allowed: false };
    }
    
    await storage.users.updateUserLastLogin(user.id);
    
    const userName = updatedUser.firstName && updatedUser.lastName
      ? `${updatedUser.firstName} ${updatedUser.lastName}`
      : updatedUser.email;
    const logData = {
      userId: user.id,
      email: updatedUser.email,
      userName,
      replitUserId: replitUserId,
    };
    setImmediate(() => {
      const context = getRequestContext();
      storageLogger.info("Authentication event: login", {
        module: "auth",
        operation: "login",
        entity_id: logData.userId,
        description: `User logged in: ${logData.userName}`,
        user_id: logData.userId,
        user_email: logData.email,
        ip_address: context?.ipAddress,
        meta: {
          userId: logData.userId,
          email: logData.email,
          replitUserId: logData.replitUserId,
        },
      });
    });
    
    return { allowed: true, user: updatedUser };
  }
  
  user = await storage.users.getUserByEmail(email);
  
  if (!user) {
    console.log("No provisioned account found for email:", email);
    return { allowed: false };
  }
  
  if (!user.isActive) {
    console.log("User account is inactive:", user.id);
    return { allowed: false };
  }
  
  console.log("Linking Replit account to provisioned user:", user.id);
  const linkedUser = await storage.users.linkReplitAccount(user.id, replitUserId, {
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
  
  if (!linkedUser) {
    return { allowed: false };
  }
  
  await storage.users.updateUserLastLogin(user.id);
  
  const userName = linkedUser.firstName && linkedUser.lastName
    ? `${linkedUser.firstName} ${linkedUser.lastName}`
    : linkedUser.email;
  const logData = {
    userId: user.id,
    email: linkedUser.email,
    userName,
    replitUserId: replitUserId,
  };
  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entity_id: logData.userId,
      description: `User logged in (account linked): ${logData.userName}`,
      user_id: logData.userId,
      user_email: logData.email,
      ip_address: context?.ipAddress,
      meta: {
        userId: logData.userId,
        email: logData.email,
        replitUserId: logData.replitUserId,
        accountLinked: true,
      },
    });
  });
  
  return { allowed: true, user: linkedUser };
}

export async function setupReplitAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Skip OIDC setup if running in mock mode outside of Replit (no REPL_ID)
  const isRunningOutsideReplit = !process.env.REPL_ID;
  if (isMockAuthEnabled() && isRunningOutsideReplit) {
    logger.info("Mock auth enabled without REPL_ID - skipping Replit OIDC setup", {
      source: "auth",
    });
    
    // Set up minimal passport serialization for session support
    passport.serializeUser((user: Express.User, cb) => cb(null, user));
    passport.deserializeUser((user: Express.User, cb) => cb(null, user));
    
    // Provide stub routes that redirect appropriately in mock mode
    app.get("/api/login", (_req, res) => {
      res.redirect("/");
    });
    app.get("/api/callback", (_req, res) => {
      res.redirect("/");
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
        const replitUserId = sessionUser.claims.sub;
        const dbUser = await storage.users.getUserByReplitId(replitUserId);
        if (dbUser) {
          sessionUser.dbUser = dbUser;
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
        const replitUserId = user.claims.sub;
        const wasMasquerading = !!session.masqueradeUserId;
        
        let dbUser;
        if (session.masqueradeUserId) {
          dbUser = await storage.users.getUser(session.masqueradeUserId);
        } else {
          dbUser = await storage.users.getUserByReplitId(replitUserId);
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
