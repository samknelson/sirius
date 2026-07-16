import bcrypt from "bcrypt";
import { z } from "zod";
import type { Express, RequestHandler, Request, Response } from "express";
import type { AuthProvider, LocalProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { checkFlood, recordFloodEvent } from "../../flood/service";
import {
  LOCAL_LOGIN_FLOOD_EVENT,
  LOCAL_PASSWORD_CHANGE_FLOOD_EVENT,
} from "../../flood/events";
import { requireAccess } from "../../services/access-policy-evaluator";
import { getDbUserFromSession } from "../helpers";

const loginBodySchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(200),
});

const BCRYPT_COST = 12;

/**
 * bcrypt silently truncates input at 72 bytes; since the pepper is appended
 * to the password before hashing, cap the accepted password length so the
 * pepper always contributes to the hash.
 */
function buildPasswordSchema(pepper: string) {
  const pepperBytes = Buffer.byteLength(pepper, "utf8");
  const maxBytes = 72 - pepperBytes;
  return z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(200)
    .refine((value) => Buffer.byteLength(value, "utf8") <= maxBytes, {
      message: `Password is too long (max ${maxBytes} bytes)`,
    });
}

/**
 * Local email + password authentication.
 *
 * Credentials live on the `auth_identities` row with providerType "local":
 * externalId is the lowercased email, passwordHash is a bcrypt hash. Rows are
 * seeded at boot from LOCAL_AUTH_EMAIL / LOCAL_AUTH_PASSWORD_HASH (see
 * ../local-seed.ts). There is intentionally no self-serve registration, but
 * passwords can be managed in-app: admins can set/reset any user's password
 * (POST /api/admin/users/:id/local-password) and a signed-in user can change
 * their own (POST /api/auth/local/change-password, current password
 * required). Both endpoints only exist when this provider is enabled.
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

    app.post("/api/auth/local/change-password", (req, res) => {
      void this.handleChangeOwnPassword(req, res);
    });

    app.post(
      "/api/admin/users/:id/local-password",
      requireAccess("admin"),
      (req, res) => {
        void this.handleAdminSetPassword(req, res);
      },
    );

    logger.info("Local auth provider initialized", { service: "local-auth" });
  }

  private async hashPassword(password: string): Promise<string> {
    const pepper = this.config.pepper || "";
    return bcrypt.hash(password + pepper, BCRYPT_COST);
  }

  /**
   * Self-service password change. Requires the current password; failed
   * verifications are flood-limited per user+IP. Applies to the REAL
   * signed-in user (the session's own credentials), never a masqueraded one.
   */
  private async handleChangeOwnPassword(req: Request, res: Response): Promise<void> {
    if (!req.isAuthenticated?.() || !req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const bodySchema = z.object({
      currentPassword: z.string().min(1).max(200),
      newPassword: buildPasswordSchema(this.config.pepper || ""),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.errors[0]?.message || "Invalid request",
      });
      return;
    }

    try {
      const dbUser = await getDbUserFromSession(req.user);
      if (!dbUser) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }

      const ip = req.ip || "unknown";
      const floodContext = { userId: dbUser.id, ip };

      // Throttle failed current-password guesses. Best-effort: fail OPEN so a
      // flood-infrastructure problem never blocks legitimate changes.
      try {
        const flood = await checkFlood(LOCAL_PASSWORD_CHANGE_FLOOD_EVENT, floodContext);
        if (!flood.allowed) {
          res.status(429).json({ message: "Too many attempts. Please try again later." });
          return;
        }
      } catch (error) {
        logger.warn("Password-change flood check failed (failing open)", {
          service: "local-auth",
          error: error instanceof Error ? error.message : String(error),
        });
      }

      const identity = await storage.authIdentities.getByUserIdAndProvider(
        dbUser.id,
        "local",
      );
      if (!identity || !identity.passwordHash) {
        res.status(400).json({
          message: "No local password is set for this account. Ask an administrator to set one.",
        });
        return;
      }

      const pepper = this.config.pepper || "";
      const matches = await bcrypt.compare(
        parsed.data.currentPassword + pepper,
        identity.passwordHash,
      );
      if (!matches) {
        try {
          await recordFloodEvent(LOCAL_PASSWORD_CHANGE_FLOOD_EVENT, floodContext);
        } catch (error) {
          logger.warn("Failed to record password-change flood event", {
            service: "local-auth",
            error: error instanceof Error ? error.message : String(error),
          });
        }
        res.status(401).json({ message: "Current password is incorrect" });
        return;
      }

      const newHash = await this.hashPassword(parsed.data.newPassword);
      await storage.authIdentities.upsertLocalPasswordHash(
        dbUser.id,
        identity.externalId,
        newHash,
      );

      this.logPasswordEvent("password_change", dbUser.id, { self: true });
      res.json({ success: true });
    } catch (error) {
      logger.error("Local password change error", {
        service: "local-auth",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to change password" });
    }
  }

  /**
   * Admin set/reset of any user's local password. No current password needed;
   * gated by the admin access policy. Creates the local identity if the user
   * doesn't have one yet (requires the user to have an email).
   */
  private async handleAdminSetPassword(req: Request, res: Response): Promise<void> {
    const bodySchema = z.object({
      password: buildPasswordSchema(this.config.pepper || ""),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        message: parsed.error.errors[0]?.message || "Invalid request",
      });
      return;
    }

    try {
      const user = await storage.users.getUser(req.params.id);
      if (!user) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      if (!user.email) {
        res.status(400).json({
          message: "User has no email address, so a local login cannot be created",
        });
        return;
      }

      const hash = await this.hashPassword(parsed.data.password);
      await storage.authIdentities.upsertLocalPasswordHash(user.id, user.email, hash);

      this.logPasswordEvent("password_set", user.id, { self: false });
      res.json({ success: true });
    } catch (error) {
      logger.error("Admin local password set error", {
        service: "local-auth",
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to set password" });
    }
  }

  /**
   * Audit trail for password management. Never includes the plaintext
   * password or the hash — only who changed whose password.
   */
  private logPasswordEvent(
    operation: "password_change" | "password_set",
    targetUserId: string,
    details: { self: boolean },
  ) {
    setImmediate(() => {
      const context = getRequestContext();
      storageLogger.info(`Authentication event: ${operation}`, {
        module: "auth",
        operation,
        entityType: "user",
        entityId: targetUserId,
        details: {
          provider: "local",
          selfService: details.self,
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
