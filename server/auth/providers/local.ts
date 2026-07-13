import bcrypt from "bcrypt";
import { z } from "zod";
import type { Express, RequestHandler, Request, Response } from "express";
import type { AuthProvider, LocalProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { checkFlood, recordFloodEvent } from "../../flood/service";
import { LOCAL_LOGIN_FLOOD_EVENT } from "../../flood/events";

const loginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

/**
 * Local email + password authentication.
 *
 * Credentials live on the `auth_identities` row with providerType "local":
 * externalId is the lowercased email, passwordHash is a bcrypt hash. Rows are
 * seeded at boot from LOCAL_AUTH_EMAIL / LOCAL_AUTH_PASSWORD_HASH (see
 * ../local-seed.ts) — there is intentionally no self-serve registration or
 * password-change endpoint.
 */
class LocalAuthProvider implements AuthProvider {
  type = "local" as const;
  private config: LocalProviderConfig;

  constructor(config: LocalProviderConfig) {
    this.config = config;
  }

  async setup(app: Express): Promise<void> {
    app.post("/api/auth/local/login", (req, res) => {
      void this.handleLogin(req, res);
    });

    logger.info("Local auth provider initialized", { service: "local-auth" });
  }

  private async handleLogin(req: Request, res: Response): Promise<void> {
    const parsed = loginBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: "Email and password are required" });
      return;
    }

    const email = parsed.data.email.trim().toLowerCase();
    const password = parsed.data.password;
    const ip = req.ip || "unknown";
    const floodContext = { email, ip };

    // Throttle brute-force attempts per email+IP bucket. The flood framework
    // is best-effort here: if it errors we fail OPEN (allow the attempt) so a
    // flood-infrastructure problem can never lock everyone out.
    try {
      const flood = await checkFlood(LOCAL_LOGIN_FLOOD_EVENT, floodContext);
      if (!flood.allowed) {
        logger.warn("Local login throttled", { service: "local-auth", email, ip });
        res.status(429).json({ message: "Too many login attempts. Please try again later." });
        return;
      }
    } catch (error) {
      logger.warn("Local login flood check failed (failing open)", {
        service: "local-auth",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      const identity = await storage.authIdentities.getByProviderAndExternalId("local", email);

      // Always run a bcrypt comparison so response timing does not reveal
      // whether the email exists.
      const dummyHash = "$2b$12$C6UzMDM.H6dfI/f/IKcEeO7ZBB3sO8HH0mZ0F0dGxTZBoUmqK3O9K";
      const hashToCheck = identity?.passwordHash || dummyHash;
      const pepper = this.config.pepper || "";
      const passwordMatches = await bcrypt.compare(password + pepper, hashToCheck);

      if (!identity || !identity.passwordHash || !passwordMatches) {
        await this.recordFailedAttempt(floodContext);
        logger.info("Local login failed", {
          service: "local-auth",
          email,
          reason: !identity ? "unknown_email" : !identity.passwordHash ? "no_password_set" : "bad_password",
        });
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }

      const user = await storage.users.getUser(identity.userId);
      if (!user) {
        await this.recordFailedAttempt(floodContext);
        logger.warn("Local auth identity found but user missing", {
          service: "local-auth",
          identityId: identity.id,
        });
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }

      if (!user.isActive) {
        await this.recordFailedAttempt(floodContext);
        logger.info("Local login rejected: user inactive", {
          service: "local-auth",
          userId: user.id,
        });
        res.status(401).json({ message: "Invalid email or password" });
        return;
      }

      const sessionUser: AuthenticatedUser = {
        claims: {
          sub: identity.externalId,
          email: user.email || email,
          first_name: user.firstName || undefined,
          last_name: user.lastName || undefined,
        },
        dbUser: user,
        providerType: "local",
      };

      req.login(sessionUser as unknown as Express.User, (loginErr) => {
        void (async () => {
          if (loginErr) {
            logger.error("Local session login error", { error: loginErr });
            res.status(500).json({ message: "Failed to establish session" });
            return;
          }

          try {
            await storage.authIdentities.updateLastUsed(identity.id);
            await storage.users.updateUserLastLogin(user.id);
          } catch (error) {
            logger.warn("Failed to record local login bookkeeping", {
              service: "local-auth",
              error: error instanceof Error ? error.message : String(error),
            });
          }

          this.logLoginEvent(user, identity.externalId);
          res.json({ success: true });
        })();
      });
    } catch (error) {
      logger.error("Local login error", {
        service: "local-auth",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Login failed" });
    }
  }

  private async recordFailedAttempt(context: { email: string; ip: string }): Promise<void> {
    try {
      await recordFloodEvent(LOCAL_LOGIN_FLOOD_EVENT, context);
    } catch (error) {
      logger.warn("Failed to record local login flood event", {
        service: "local-auth",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private logLoginEvent(user: { id: string; email: string | null; firstName?: string | null; lastName?: string | null }, externalId: string) {
    const userName =
      user.firstName && user.lastName
        ? `${user.firstName} ${user.lastName}`
        : user.email;

    setImmediate(() => {
      const context = getRequestContext();
      storageLogger.info("Authentication event: login", {
        module: "auth",
        operation: "login",
        entityType: "user",
        entityId: user.id,
        details: {
          provider: "local",
          externalId,
          userName,
          accountLinked: false,
        },
        request: context
          ? {
              userId: context.userId,
              ip: context.ipAddress,
            }
          : undefined,
      });
    });
  }

  getLoginHandler(): RequestHandler {
    // GET /api/login?provider=local — the credential form lives in the SPA.
    return (_req: Request, res: Response) => {
      res.redirect("/login");
    };
  }

  getCallbackHandler(): RequestHandler {
    return (_req: Request, res: Response) => {
      res.status(404).json({ message: "Local auth has no callback" });
    };
  }

  getLogoutHandler(): RequestHandler {
    return (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUser | undefined;

      if (user) {
        logger.info("Local logout", {
          service: "local-auth",
          userId: user.dbUser?.id,
          externalId: user.claims?.sub,
        });
      }

      req.logout((err) => {
        if (err) {
          logger.error("Local logout error", { error: err });
        }

        req.session?.destroy((sessionErr) => {
          if (sessionErr) {
            logger.error("Session destruction error", { error: sessionErr });
          }
          res.redirect("/");
        });
      });
    };
  }
}

export function createProvider(config: LocalProviderConfig): AuthProvider {
  return new LocalAuthProvider(config);
}
