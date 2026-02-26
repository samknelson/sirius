import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession, getReplitLogoutUrl, logLogoutEvent } from "./replit";
import { setupSamlAuth, isSamlConfigured } from "./saml";
import { setupCognitoAuth, isCognitoConfigured } from "./cognito";
import type { AuthProviderType } from "@shared/schema";
import { logger } from "../logger";
import { storage } from "../storage";

export type AuthProvider = AuthProviderType;

function isMockAuthEnabled(): boolean {
  if (process.env.MOCK_AUTH !== "true") return false;

  const isProductionBranch = ["prod-hta", "prod-btu"].some(
    (branch) => process.env.FC_BRANCH === branch || process.env.GIT_BRANCH === branch
  );
  if (isProductionBranch) {
    logger.error("MOCK_AUTH is set on a production branch — ignoring for safety", {
      source: "auth",
      branch: process.env.FC_BRANCH || process.env.GIT_BRANCH,
    });
    return false;
  }

  return true;
}

export function getAuthProvider(): AuthProvider {
  if (isSamlConfigured()) {
    return "saml";
  }
  if (isCognitoConfigured()) {
    return "oauth";
  }
  if (process.env.REPL_ID) {
    return "replit";
  }
  return "replit";
}

async function setupMockAuth(app: Express): Promise<void> {
  const mockEmail = process.env.MOCK_USER_EMAIL || "admin@preview.local";
  const mockExternalId = `mock-${mockEmail}`;

  logger.warn("Mock auth enabled — all requests will be auto-authenticated", {
    source: "auth",
    mockEmail,
  });

  app.use(async (req, _res, next) => {
    if ((req as any).user) {
      return next();
    }

    const session = req.session as any;
    if (session?.passport?.user) {
      return next();
    }

    try {
      let identity = await storage.authIdentities.getByProviderAndExternalId("local", mockExternalId);
      let dbUser;

      if (identity) {
        dbUser = await storage.users.getUser(identity.userId);
      } else {
        dbUser = await storage.users.getUserByEmail(mockEmail);
        if (!dbUser) {
          dbUser = await storage.users.createUser({
            email: mockEmail,
            firstName: "Preview",
            lastName: "Admin",
            isActive: true,
          });
        }
        identity = await storage.authIdentities.create({
          userId: dbUser!.id,
          providerType: "local",
          externalId: mockExternalId,
          email: mockEmail,
          displayName: "Preview Admin",
        });
      }

      const mockUser = {
        claims: {
          sub: mockExternalId,
          email: mockEmail,
          first_name: "Preview",
          last_name: "Admin",
        },
        expires_at: Math.floor(Date.now() / 1000) + 86400,
        providerType: "local",
        dbUser,
      };

      (req as any).user = mockUser;
      req.isAuthenticated = () => true;

      if (session) {
        session.passport = { user: mockUser };
      }
    } catch (error) {
      logger.error("Mock auth error", { source: "auth", error: (error as Error).message });
    }

    next();
  });
}

export async function setupAuth(app: Express): Promise<void> {
  await setupReplitAuth(app);
  
  const providers: string[] = [];
  
  if (isMockAuthEnabled()) {
    await setupMockAuth(app);
    providers.push("mock");
    logger.warn("Mock auth is active — preview environment", { source: "auth" });
  }

  if (process.env.REPL_ID) {
    providers.push("replit");
  }
  
  const samlConfigured = await setupSamlAuth(app);
  if (samlConfigured) {
    providers.push("saml");
  }
  
  const cognitoConfigured = await setupCognitoAuth(app);
  if (cognitoConfigured) {
    providers.push("cognito");
  }
  
  if (providers.length > 1) {
    logger.info("Multiple auth providers configured", {
      source: "auth",
      providers,
    });
  }
  
  app.get("/api/auth/providers", (_req, res) => {
    res.json({
      providers: {
        replit: !!process.env.REPL_ID,
        saml: samlConfigured,
        cognito: cognitoConfigured,
        mock: isMockAuthEnabled(),
      },
    });
  });
  
  app.get("/api/logout", async (req, res) => {
    const user = req.user as any;
    const providerType = user?.providerType;
    
    logger.info("Unified logout requested", {
      source: "auth",
      providerType,
      hasUser: !!user,
    });
    
    await logLogoutEvent(req);
    
    if (providerType === "oauth" && cognitoConfigured) {
      return res.redirect("/api/auth/cognito/logout");
    }
    
    if (providerType === "saml" && samlConfigured) {
      return res.redirect("/api/saml/logout");
    }
    
    if (providerType === "replit" && process.env.REPL_ID) {
      const replitLogoutUrl = await getReplitLogoutUrl(req);
      if (replitLogoutUrl) {
        req.logout(() => {
          res.redirect(replitLogoutUrl);
        });
        return;
      }
    }
    
    req.logout((err) => {
      if (err) {
        logger.error("Logout error", { source: "auth", error: err.message });
      }
      req.session?.destroy((sessionErr) => {
        if (sessionErr) {
          logger.error("Session destroy error", { source: "auth", error: sessionErr.message });
        }
        res.redirect("/login");
      });
    });
  });
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (isMockAuthEnabled() && (req as any).user) {
    return next();
  }
  return replitIsAuthenticated(req, res, next);
};

export function getSession() {
  return replitGetSession();
}

export { getCurrentUser } from "./currentUser";
