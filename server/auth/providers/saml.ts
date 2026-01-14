import passport from "passport";
import { Strategy as SamlStrategy, type Profile } from "@node-saml/passport-saml";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import type { AuthProvider, SamlProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";

const STRATEGY_NAME = "saml";

interface SamlProfile {
  nameID?: string;
  nameIDFormat?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  [key: string]: unknown;
}

function extractProfileData(profile: SamlProfile): {
  externalId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
} {
  const externalId = profile.nameID || profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] as string;
  
  const email = 
    profile.email ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string ||
    profile.nameID;
  
  const firstName = 
    profile.firstName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"] as string ||
    profile["User.FirstName"] as string;
  
  const lastName = 
    profile.lastName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"] as string ||
    profile["User.LastName"] as string;
  
  const displayName = 
    profile.displayName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] as string ||
    (firstName && lastName ? `${firstName} ${lastName}` : undefined);

  return { externalId, email, firstName, lastName, displayName };
}

async function checkUserAccess(
  profile: SamlProfile
): Promise<{ allowed: boolean; user?: any }> {
  const { externalId, email, firstName, lastName, displayName } = extractProfileData(profile);

  logger.info("SAML Auth attempt", {
    service: "saml-auth",
    externalId,
    email,
    firstName,
    lastName,
  });

  if (!externalId) {
    logger.warn("SAML profile missing nameID", { profile });
    return { allowed: false };
  }

  let identity = await storage.authIdentities.getByProviderAndExternalId("saml", externalId);

  if (identity) {
    const user = await storage.users.getUser(identity.userId);
    if (!user) {
      logger.warn("SAML auth identity found but user missing", { identityId: identity.id });
      return { allowed: false };
    }

    if (!user.isActive) {
      logger.info("User account is inactive", { userId: user.id });
      return { allowed: false };
    }

    await storage.authIdentities.update(identity.id, {
      email,
      displayName,
    });
    await storage.authIdentities.updateLastUsed(identity.id);

    const updatedUser = await storage.users.updateUser(user.id, {
      email,
      firstName,
      lastName,
    });

    await storage.users.updateUserLastLogin(user.id);
    logLoginEvent(updatedUser, externalId, false);

    return { allowed: true, user: updatedUser };
  }

  if (!email) {
    logger.info("SAML profile missing email, cannot link account", { externalId });
    return { allowed: false };
  }

  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    logger.info("No provisioned account found for SAML email", { email });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking SAML account to provisioned user", { userId: user.id, email });

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "saml",
    externalId,
    email,
    displayName,
  });

  const linkedUser = await storage.users.updateUser(user.id, {
    email,
    firstName,
    lastName,
    accountStatus: "linked",
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
      entityType: "user",
      entityId: user.id,
      details: {
        provider: "saml",
        externalId,
        userName,
        accountLinked,
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

class SamlAuthProvider implements AuthProvider {
  type = "saml" as const;
  private config: SamlProviderConfig;
  private callbackUrl: string = "";

  constructor(config: SamlProviderConfig) {
    this.config = config;
  }

  async setup(app: Express): Promise<void> {
    const host = process.env.REPLIT_DEV_DOMAIN || process.env.REPL_SLUG + "." + process.env.REPL_OWNER + ".repl.co";
    const protocol = "https";
    this.callbackUrl = `${protocol}://${host}${this.config.callbackPath || "/api/auth/saml/callback"}`;

    const samlStrategy = new SamlStrategy(
      {
        entryPoint: this.config.entryPoint,
        issuer: this.config.issuer || `${protocol}://${host}`,
        idpCert: this.config.cert,
        callbackUrl: this.callbackUrl,
        wantAuthnResponseSigned: false,
        wantAssertionsSigned: true,
        signatureAlgorithm: "sha256",
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      },
      (profile: Profile | null, done: (err: Error | null, user?: Record<string, unknown>) => void) => {
        (async () => {
          try {
            if (!profile) {
              return done(null, undefined);
            }
            
            const samlProfile = profile as unknown as SamlProfile;
            const { allowed, user } = await checkUserAccess(samlProfile);

            if (!allowed) {
              return done(null, undefined);
            }

            const { externalId, email, firstName, lastName } = extractProfileData(samlProfile);

            const sessionUser: AuthenticatedUser = {
              claims: {
                sub: externalId,
                email,
                first_name: firstName,
                last_name: lastName,
              },
              dbUser: user,
              providerType: "saml",
            };

            return done(null, sessionUser as unknown as Record<string, unknown>);
          } catch (error) {
            logger.error("SAML authentication error", { error });
            return done(error as Error);
          }
        })();
      },
      (profile: Profile | null, done: (err: Error | null, user?: Record<string, unknown>) => void) => {
        if (!profile) {
          return done(null, undefined);
        }
        const samlProfile = profile as unknown as SamlProfile;
        const { externalId, email, firstName, lastName } = extractProfileData(samlProfile);
        
        const sessionUser: AuthenticatedUser = {
          claims: {
            sub: externalId,
            email,
            first_name: firstName,
            last_name: lastName,
          },
          providerType: "saml",
        };
        return done(null, sessionUser as unknown as Record<string, unknown>);
      }
    );

    passport.use(STRATEGY_NAME, samlStrategy);

    const callbackPath = this.config.callbackPath || "/api/auth/saml/callback";
    app.post(callbackPath, this.getCallbackHandler());

    app.get("/api/auth/saml/metadata", (req, res) => {
      res.type("application/xml");
      const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${this.config.issuer || `${protocol}://${host}`}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${this.callbackUrl}" index="0"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
      res.send(metadata);
    });

    logger.info("SAML auth provider initialized", {
      service: "saml-auth",
      entryPoint: this.config.entryPoint,
      callbackUrl: this.callbackUrl,
    });
  }

  getLoginHandler(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const redirectPath = req.query.redirect as string || "/";
      
      passport.authenticate(STRATEGY_NAME, {
        additionalParams: {},
      } as any)(req, res, next);
    };
  }

  getCallbackHandler(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(STRATEGY_NAME, {
        failureRedirect: "/auth-error?error=saml_failed",
        session: true,
      })(req, res, (err: any) => {
        if (err) {
          logger.error("SAML callback error", { error: err });
          return res.redirect("/auth-error?error=saml_callback_failed");
        }

        if (!req.user) {
          return res.redirect("/auth-error?error=access_denied");
        }

        req.login(req.user, (loginErr) => {
          if (loginErr) {
            logger.error("SAML session login error", { error: loginErr });
            return res.redirect("/auth-error?error=session_failed");
          }

          res.redirect("/");
        });
      });
    };
  }

  getLogoutHandler(): RequestHandler {
    return async (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUser | undefined;

      if (user) {
        logger.info("SAML logout", {
          service: "saml-auth",
          userId: user.dbUser?.id,
          externalId: user.claims?.sub,
        });
      }

      req.logout((err) => {
        if (err) {
          logger.error("SAML logout error", { error: err });
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

export function createProvider(config: SamlProviderConfig): AuthProvider {
  return new SamlAuthProvider(config);
}
