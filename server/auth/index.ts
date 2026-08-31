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

/**
 * Session middleware options, exported separately so lifecycle tests can
 * assert on and exercise the exact configuration the app runs with.
 */
export function buildSessionOptions(params: {
  secret: string;
  sessionTtl: number;
  isProduction: boolean;
  store?: session.Store;
}): session.SessionOptions {
  return {
    secret: params.secret,
    store: params.store ?? new StorageSessionStore({ ttlMs: params.sessionTtl }),
    resave: false,
    saveUninitialized: false,
    // Rolling cookies: every response on an authenticated session re-sends
    // the cookie with a fresh maxAge, which also makes express-session call
    // store.touch() — so ACTIVE users advance both the browser cookie and the
    // persisted `sessions.expire` row together, while an idle session still
    // dies after `sessionTtl` of no requests.
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: params.isProduction,
      maxAge: params.sessionTtl,
    },
  };
}

export function getSession(): RequestHandler {
  const config = getAuthConfig();
  const sessionTtl = config.sessionTtl || 7 * 24 * 60 * 60 * 1000; // Default: 1 week

  // Session persistence goes through the storage layer (storage.sessions.*)
  // like every other table, on the single shared db.ts pool. Expired rows are
  // pruned by the `session-prune` cron plugin.
  return session(
    buildSessionOptions({
      secret: config.sessionSecret,
      sessionTtl,
      isProduction: getEnvironmentVariable("NODE_ENV") === "production",
    }),
  );
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

/**
 * Persist a refreshed passport user back into the session row so rotated
 * provider credentials (e.g. a rotated Okta refresh token) survive later
 * requests and other application instances. `req.user` is usually the same
 * object as `session.passport.user`, but we assign explicitly and save
 * before continuing so the write cannot be lost to a crash or a competing
 * request hitting another instance mid-flight.
 *
 * Resolves true when the session row was durably saved (one retry on
 * failure), false otherwise. Callers must NOT continue the protected request
 * on false: Okta may have rotated the refresh token, and serving the request
 * with only-in-memory credentials would let a later request (or another
 * instance) load the stale, now-invalid token from the store.
 */
async function persistRefreshedUser(req: Parameters<RequestHandler>[0]): Promise<boolean> {
  const sessionData = req.session as unknown as {
    passport?: { user?: unknown };
    save: (cb: (err?: unknown) => void) => void;
  };
  if (sessionData.passport) {
    sessionData.passport.user = req.user;
  }
  const saveOnce = () =>
    new Promise<unknown>((resolve) => sessionData.save((err?: unknown) => resolve(err)));

  let err = await saveOnce();
  if (err) {
    err = await saveOnce(); // one retry — session-store writes can fail transiently
  }
  if (err) {
    logger.error("Failed to persist refreshed credentials to session", {
      service: "auth",
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
  return true;
}

/**
 * Authentication gate for protected routes.
 *
 * The persisted Sirius session is the authoritative login lifetime:
 * - No session → 401 (local-session expiry / not signed in).
 * - Provider access token expired but no refresh capability → the request
 *   proceeds; the access token is not used outside authentication, so its
 *   expiry alone must not terminate a valid active session.
 * - Refresh capability present → refresh is attempted; success is durably
 *   persisted to the session (including rotated refresh tokens) before the
 *   request continues; explicit provider rejection (revocation-class OAuth
 *   error → refreshToken returns null) destroys the session down one
 *   explicit reauth path; a transient refresh error (thrown) preserves the
 *   session and the refresh is retried on a later request.
 */
export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as AuthenticatedUser | undefined;

  if (!req.isAuthenticated() || !user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  if (user.expires_at) {
    const now = Math.floor(Date.now() / 1000);
    if (now > user.expires_at) {
      const provider = user.providerType
        ? providerRegistry.get(user.providerType)
        : undefined;

      if (!user.refresh_token || !provider?.refreshToken) {
        // No refresh capability. The local session governs login lifetime;
        // continue rather than logging the active user out.
        logger.info(
          "Provider access token expired with no refresh capability; local session remains authoritative",
          {
            service: "auth",
            providerType: user.providerType,
            userId: user.dbUser?.id,
            hasRefreshToken: Boolean(user.refresh_token),
          },
        );
        return next();
      }

      let refreshedUser: AuthenticatedUser | null = null;
      try {
        refreshedUser = await provider.refreshToken(user);
      } catch (error) {
        // Transient failure (network outage, token endpoint down, unexpected
        // error). This says nothing about whether the credentials are
        // revoked, so the local session stays authoritative: continue and
        // retry the refresh on a later request.
        logger.warn(
          "Provider token refresh errored transiently; local session remains authoritative",
          {
            service: "auth",
            providerType: user.providerType,
            userId: user.dbUser?.id,
            reason: "refresh_transient_error",
            error: error instanceof Error ? error.message : String(error),
          },
        );
        return next();
      }

      if (refreshedUser) {
        Object.assign(user, refreshedUser);
        if (!(await persistRefreshedUser(req))) {
          // The provider may have rotated the refresh token; without a
          // durable save, a later request would load the stale token from
          // the store. Fail this request explicitly (retryable) rather than
          // continuing with unpersisted credentials or logging the user out.
          return res
            .status(503)
            .json({ message: "Could not persist refreshed session; please retry" });
        }
        return next();
      }

      // Provider explicitly rejected the refresh (revocation-class OAuth
      // error, e.g. invalid_grant): the stored credentials are unusable.
      // One explicit reauth path — destroy the session and signal the
      // client to sign in again.
      logger.warn("Provider rejected token refresh; requiring reauthentication", {
        service: "auth",
        providerType: user.providerType,
        userId: user.dbUser?.id,
        reason: "provider_rejected",
      });
      return req.logout(() => {
        req.session?.destroy(() => {
          res
            .status(401)
            .json({ message: "Session expired", code: "reauth_required" });
        });
      });
    }
  }

  return next();
};

export type { AuthProvider, AuthConfig, ProviderConfig } from "./types";
export type { AuthProviderType } from "@shared/schema";
