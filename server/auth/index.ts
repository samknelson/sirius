import type { Express, RequestHandler, Request } from "express";
import passport from "passport";
import session from "express-session";
import { StorageSessionStore } from "./session-store";
import { loadAuthConfig, getProviderConfig } from "./config";
import type {
  AuthConfig,
  AuthProvider,
  ProviderRegistry,
  AuthenticatedUser,
  ProviderConfig,
} from "./types";
import type { AuthProviderType } from "@shared/schema";
import { logger } from "../logger";
import { loadProvider } from "./provider-loader";
import { isWorkerSelfRegistrationEnabled } from "./worker-provisioning";
import { getEnvironmentVariable } from "../config/env-registry";

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

  // Session persistence goes through the storage layer (storage.sessions.*)
  // like every other table, on the single shared db.ts pool. Expired rows are
  // pruned by the `session-prune` cron plugin.
  const sessionStore = new StorageSessionStore({ ttlMs: sessionTtl });

  const isProduction = getEnvironmentVariable("NODE_ENV") === "production";

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
        const { resolveDbUser } = await import("./helpers");
        await resolveDbUser(sessionUser, sessionUser.claims.sub);
      } catch (error) {
        logger.error("Failed to rehydrate dbUser during deserialization", { error });
      }
    }
    cb(null, user);
  });

  const validProviderTypes = ["replit", "okta", "saml", "oauth", "local", "clerk"] as const;
  
  for (const providerConfig of config.providers) {
    if (!providerConfig.enabled) continue;

    if (!validProviderTypes.includes(providerConfig.type)) {
      throw new Error(`Invalid auth provider type: "${providerConfig.type}". Valid types: ${validProviderTypes.join(", ")}`);
    }

    try {
      const provider = await loadProvider(providerConfig);

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

  // Fallback for the SAML callback path when the SAML provider is NOT
  // registered — i.e. "saml" is not listed in AUTH_PROVIDER at all. (A listed
  // provider now registers even with unresolved vars and owns its routes,
  // redirecting to saml_not_configured itself when config is incomplete.)
  // Registered after provider setup, so a registered SAML provider's own
  // routes win. Without this, hits fell through to the SPA catch-all as a
  // confusing 404 page.
  if (!providerRegistry.get("saml")) {
    // Honor a custom SAML_CALLBACK_PATH so a configured-but-uninitializable
    // SAML setup (e.g. missing cert) still lands here, not the SPA 404.
    // Guard against non-local values: only a local absolute path is routable.
    const { getEnvironmentVariable } = await import("../config/env-registry");
    const custom = getEnvironmentVariable("SAML_CALLBACK_PATH");
    const samlCallbackPath =
      custom && custom.startsWith("/") && !custom.startsWith("//")
        ? custom
        : "/api/auth/saml/callback";
    app.all(samlCallbackPath, (_req, res) => {
      logger.warn("SAML callback hit but no SAML provider is configured", {
        service: "saml-auth",
      });
      res.redirect("/auth-error?error=saml_not_configured");
    });
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
    res.json({
      providers,
      defaultProvider: config.defaultProvider,
      workerRegistrationEnabled: isWorkerSelfRegistrationEnabled(),
    });
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
