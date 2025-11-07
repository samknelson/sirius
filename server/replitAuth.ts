// Replit Auth integration with restricted access
// Based on blueprint:javascript_log_in_with_replit
import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

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
  // SESSION_SECRET is required for production, but provide fallback for development
  if (!process.env.SESSION_SECRET) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET environment variable is required in production');
    }
    console.warn('WARNING: Using fallback SESSION_SECRET for development. Set SESSION_SECRET in production!');
  }
  
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  // Use secure cookies in production only (requires HTTPS)
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

// Email-based provisioning: Check if user exists or can be linked
async function checkUserAccess(
  claims: any,
): Promise<{ allowed: boolean; user?: any }> {
  const replitUserId = claims["sub"];
  const email = claims["email"];
  
  // Log the Replit user information for debugging
  console.log("Replit Auth attempt:", {
    replitId: replitUserId,
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
  });
  
  // First, try to find user by Replit ID (already linked account)
  let user = await storage.users.getUserByReplitId(replitUserId);
  
  if (user) {
    console.log("Found existing linked account:", user.id);
    
    // Check if user is active
    if (!user.isActive) {
      console.log("User account is inactive:", user.id);
      return { allowed: false };
    }
    
    // Update user info from Replit (name, profile image may have changed)
    const updatedUser = await storage.users.updateUser(user.id, {
      email: email,
      firstName: claims["first_name"],
      lastName: claims["last_name"],
      profileImageUrl: claims["profile_image_url"],
    });
    
    // Update last login
    await storage.users.updateUserLastLogin(user.id);
    
    return { allowed: true, user: updatedUser };
  }
  
  // User not found by Replit ID - check if there's a pending account with this email
  user = await storage.users.getUserByEmail(email);
  
  if (!user) {
    console.log("No provisioned account found for email:", email);
    return { allowed: false };
  }
  
  // Check if user is active
  if (!user.isActive) {
    console.log("User account is inactive:", user.id);
    return { allowed: false };
  }
  
  // Link the Replit account to this provisioned user
  console.log("Linking Replit account to provisioned user:", user.id);
  const linkedUser = await storage.users.linkReplitAccount(user.id, replitUserId, {
    email: email,
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
  
  // Update last login
  await storage.users.updateUserLastLogin(user.id);
  
  return { allowed: true, user: linkedUser };
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    
    // MODIFIED: Check if user is allowed to access the system
    const accessCheck = await checkUserAccess(tokens.claims());
    
    if (!accessCheck.allowed) {
      // User not authorized - they're not in our database or inactive
      return verified(new Error("Access denied. Please contact an administrator to set up your account."), false);
    }
    
    verified(null, user);
  };

  // Keep track of registered strategies
  const registeredStrategies = new Set<string>();

  // Helper function to ensure strategy exists for a domain
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
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

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
        // Catch any OAuth or authentication errors and redirect to unauthorized page
        console.error("Authentication callback error:", err.message);
        return res.redirect("/unauthorized");
      }
      next();
    });
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
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
