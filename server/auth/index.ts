import type { Express, RequestHandler, Request } from "express";
import passport from "passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { loadAuthConfig, getProviderConfig } from "./config";
import type {
  AuthConfig,
  AuthProvider,
  ProviderRegistry,
  AuthenticatedUser,
} from "./types";
import type { AuthProviderType } from "@shared/schema";
import { logger } from "../logger";

const getStorage = () => require("../storage").storage;

class AuthProviderRegistry implements ProviderRegistry {
  private providers = new Map<AuthProviderType, AuthProvider>();
  private defaultProviderType: AuthProviderType | null = null;

  register(provider: AuthProvider): void {
    this.providers.set(provider.type, provider);
    logger.info(`Auth provider registered: ${provider.type}`);
  }

  get(type: AuthProviderType): AuthProvider | undefined {
    return this.providers.get(type);
  }

  getDefault(): AuthProvider | undefined {
    if (this.defaultProviderType) {
      return this.providers.get(this.defaultProviderType);
    }
    const firstProvider = this.providers.values().next().value;
    return firstProvider;
  }

  getAll(): AuthProvider[] {
    return Array.from(this.providers.values());
  }

  setDefault(type: AuthProviderType): void {
    if (!this.providers.has(type)) {
      throw new Error(`Cannot set default provider: ${type} is not registered`);
    }
    this.defaultProviderType = type;
    logger.info(`Default auth provider set to: ${type}`);
  }
}

export const providerRegistry = new AuthProviderRegistry();

let authConfig: AuthConfig | null = null;

export function getAuthConfig(): AuthConfig {
  if (!authConfig) {
    authConfig = loadAuthConfig();
  }
  return authConfig;
}

export function getSession(): RequestHandler {
  const config = getAuthConfig();
  const sessionTtl = config.sessionTtl || 7 * 24 * 60 * 60 * 1000; // Default: 1 week

  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });

  const isProduction = process.env.NODE_ENV === "production";

  return session({
    secret: config.sessionSecret,
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

export async function setupAuth(app: Express): Promise<void> {
  const config = getAuthConfig();

  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser(async (user: Express.User, cb) => {
    const sessionUser = user as AuthenticatedUser;
    if (sessionUser.claims?.sub && !sessionUser.dbUser) {
      try {
        const storage = getStorage();
        if (!storage || !storage.authIdentities || !storage.users) {
          logger.warn("Storage not available during session deserialization");
          return cb(null, user);
        }
        
        const externalId = sessionUser.claims.sub;
        const providerType = sessionUser.providerType || "replit";
        
        const identity = await storage.authIdentities.getByProviderAndExternalId(
          providerType,
          externalId
        );
        
        if (identity) {
          const dbUser = await storage.users.getUser(identity.userId);
          if (dbUser) {
            sessionUser.dbUser = dbUser;
          }
        }
      } catch (error) {
        logger.error("Failed to rehydrate dbUser during deserialization", { error });
      }
    }
    cb(null, user);
  });

  const validProviderTypes = ["replit", "okta", "saml", "oauth", "local"] as const;
  
  for (const providerConfig of config.providers) {
    if (!providerConfig.enabled) continue;

    if (!validProviderTypes.includes(providerConfig.type)) {
      throw new Error(`Invalid auth provider type: "${providerConfig.type}". Valid types: ${validProviderTypes.join(", ")}`);
    }

    try {
      const providerModule = await import(`./providers/${providerConfig.type}`);
      const provider: AuthProvider = providerModule.createProvider(providerConfig);

      await provider.setup(app);
      providerRegistry.register(provider);

      if (providerConfig.isDefault) {
        providerRegistry.setDefault(providerConfig.type);
      }
    } catch (error) {
      logger.error(`Failed to load auth provider: ${providerConfig.type}`, { error });
      throw error;
    }
  }

  if (config.defaultProvider && !providerRegistry.getDefault()) {
    const defaultProvider = providerRegistry.get(config.defaultProvider);
    if (defaultProvider) {
      providerRegistry.setDefault(config.defaultProvider);
    } else {
      logger.warn(`Configured default provider "${config.defaultProvider}" not found or disabled`);
    }
  }

  if (!providerRegistry.getDefault()) {
    const registeredProviders = providerRegistry.getAll();
    if (registeredProviders.length > 0) {
      const firstProvider = registeredProviders[0];
      providerRegistry.setDefault(firstProvider.type);
      logger.info(`Using first registered provider as default: ${firstProvider.type}`);
    } else {
      throw new Error("No auth providers registered. At least one provider must be enabled.");
    }
  }

  app.get("/api/login", (req, res, next) => {
    const requestedProvider = req.query.provider as AuthProviderType | undefined;
    const provider = requestedProvider
      ? providerRegistry.get(requestedProvider)
      : providerRegistry.getDefault();

    if (!provider) {
      return res.status(400).json({ message: "No auth provider available" });
    }

    return provider.getLoginHandler()(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    const state = req.query.state as string | undefined;
    let providerType: AuthProviderType | undefined;

    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, "base64").toString());
        providerType = stateData.provider;
      } catch {
      }
    }

    const provider = providerType
      ? providerRegistry.get(providerType)
      : providerRegistry.getDefault();

    if (!provider) {
      return res.status(400).json({ message: "No auth provider for callback" });
    }

    return provider.getCallbackHandler()(req, res, next);
  });

  app.get("/api/logout", (req, res, next) => {
    const user = req.user as AuthenticatedUser | undefined;
    const providerType = user?.providerType;

    const provider = providerType
      ? providerRegistry.get(providerType)
      : providerRegistry.getDefault();

    if (!provider) {
      req.logout(() => {
        res.redirect("/");
      });
      return;
    }

    return provider.getLogoutHandler()(req, res, next);
  });

  app.get("/api/auth/providers", (_req, res) => {
    const providers = providerRegistry.getAll().map((p) => ({
      type: p.type,
      isDefault: providerRegistry.getDefault()?.type === p.type,
    }));
    res.json({ providers, defaultProvider: config.defaultProvider });
  });

  logger.info("Auth system initialized", {
    providers: config.providers.map((p) => p.type),
    defaultProvider: config.defaultProvider,
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as AuthenticatedUser | undefined;

  if (!req.isAuthenticated() || !user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.expires_at) {
    const now = Math.floor(Date.now() / 1000);
    if (now > user.expires_at) {
      if (user.providerType && user.refresh_token) {
        const provider = providerRegistry.get(user.providerType);
        if (provider?.refreshToken) {
          try {
            const refreshedUser = await provider.refreshToken(user);
            if (refreshedUser) {
              Object.assign(user, refreshedUser);
              return next();
            }
          } catch (error) {
            logger.error("Token refresh failed", { error });
          }
        }
      }
      return res.status(401).json({ message: "Token expired" });
    }
  }

  return next();
};

export type { AuthProvider, AuthConfig, ProviderConfig } from "./types";
export type { AuthProviderType } from "@shared/schema";
