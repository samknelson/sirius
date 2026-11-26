import passport from "passport";
import { Strategy as SamlStrategy, type Profile } from "@node-saml/passport-saml";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import type { AuthProvider, SamlProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { maybeProvisionUser, reconcileMappedRoles } from "../provisioning";
import { observeSaml, type RoleReconciliationFacts } from "../saml-observation";
import { getEnvironmentVariable } from "../../config/env-registry";
import { samlMilestone, samlHandoffFailure, samlHandoffError, setSamlCallbackPath } from "../saml-roundtrip";

const STRATEGY_NAME = "saml";

import { categorizeSamlError } from "./saml-error-categories";
export { categorizeSamlError } from "./saml-error-categories";

/** Best-effort base64 decode of the SAMLResponse into XML for the log entry. */
function decodeSamlResponse(raw: unknown): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    return Buffer.from(raw, "base64").toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * Persist a sanitized SAML failure so admins can diagnose IdP configuration
 * problems from the in-app log viewer (Config → Logs, module "auth"), and
 * return a short reference id and the sanitized category, both surfaced on
 * the public error page.
 */
function recordSamlFailure(
  operation: string,
  error: unknown,
  req: Request,
): { reference: string; category: string } {
  const reference = `SAML-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const err = error instanceof Error ? error : new Error(String(error));
  const { category, reason } = categorizeSamlError(err.message || "Unknown error");
  const context = getRequestContext();
  const samlResponseRaw = (req.body as Record<string, unknown> | undefined)?.SAMLResponse;
  // Full unredacted diagnostics, by explicit admin decision: the log viewer
  // is admin-gated and the admin needs the complete request to debug IdP
  // configuration problems on deployments without server-log access.
  try { storageLogger.error(`SAML sign-in failure [${reference}]`, {
    module: "auth",
    operation,
    description: reason,
    ip_address: context?.ipAddress ?? req.ip,
    reference,
    category,
    errorName: err.name,
    errorMessage: err.message,
    errorStack: err.stack,
    relayState: typeof (req.body as any)?.RelayState === "string" ? (req.body as any).RelayState : undefined,
    samlResponseXml: decodeSamlResponse(samlResponseRaw),
    samlResponseBase64: typeof samlResponseRaw === "string" ? samlResponseRaw : undefined,
  }); } catch { /* Logging must not prevent the safe error redirect. */ }
  observeSaml(req, "saml_error", {
    errorCategory: category,
    errorMessage: err.message,
  });
  return { reference, category };
}

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

/** Typed reasons a user can be denied access after a successful IdP sign-in. */
type AccessDenialReason =
  | "missing_external_id"
  | "identity_found_but_user_missing"
  | "inactive_account"
  | "missing_email"
  | "no_provisioned_account";

type SamlRequest = Request & {
  _samlAccessDenied?: { reference: string; reason: AccessDenialReason };
};

type CheckUserAccessResult =
  | { allowed: true; user: any; roleReconciliation: RoleReconciliationFacts }
  | { allowed: false; reason: AccessDenialReason; email?: string; externalId?: string };

/**
 * Persist an admin-visible access-denial log entry (module "auth") so
 * administrators can diagnose why a user who successfully authenticated at
 * the IdP was still turned away. Returns a short reference id that is
 * surfaced on the public auth-error page.
 */
function recordAccessDenied(
  reason: AccessDenialReason,
  profile: { email?: string; externalId?: string },
  req: Request
): string {
  const reference = `SAML-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const context = getRequestContext();

  const reasonMessages: Record<AccessDenialReason, string> = {
    missing_external_id:
      "SAML profile contained no nameID/externalId — cannot identify the user.",
    identity_found_but_user_missing:
      "A SAML identity record was found but the linked user account no longer exists.",
    inactive_account:
      "The account associated with this SAML identity is inactive. Re-activate it in Users to allow sign-in.",
    missing_email:
      "SAML profile contains no email address and no existing identity link — cannot provision or match an account.",
    no_provisioned_account:
      "No pre-provisioned account found for this email address. Create a user account with a matching email to grant access.",
  };

  try { storageLogger.error(`SAML access denied [${reference}]`, {
    module: "auth",
    operation: "access_denied",
    description: reasonMessages[reason],
    ip_address: context?.ipAddress ?? req.ip,
    reference,
    category: reason,
    attemptedEmail: profile.email,
    attemptedExternalId: profile.externalId,
  }); } catch { /* Logging must not change the access decision. */ }

  return reference;
}

async function checkUserAccess(profile: SamlProfile): Promise<CheckUserAccessResult> {
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
    return { allowed: false, reason: "missing_external_id", email };
  }

  let identity = await storage.authIdentities.getByProviderAndExternalId("saml", externalId);

  if (identity) {
    const user = await storage.users.getUser(identity.userId);
    if (!user) {
      logger.warn("SAML auth identity found but user missing", { identityId: identity.id });
      return { allowed: false, reason: "identity_found_but_user_missing", email, externalId };
    }

    if (!user.isActive) {
      logger.info("User account is inactive", { userId: user.id });
      return { allowed: false, reason: "inactive_account", email, externalId };
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

    const roleReconciliation = await reconcileSamlRoles(updatedUser ?? user, identity, profile);

    return { allowed: true, user: updatedUser, roleReconciliation };
  }

  if (!email) {
    logger.info("SAML profile missing email, cannot link account", { externalId });
    return { allowed: false, reason: "missing_email", externalId };
  }

  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    const provisioned = await maybeProvisionUser("saml", {
      externalId,
      email,
      firstName,
      lastName,
      displayName,
    });
    if (!provisioned) {
      logger.info("No provisioned account found for SAML email", { email });
      return { allowed: false, reason: "no_provisioned_account", email, externalId };
    }

    await storage.users.updateUserLastLogin(provisioned.user.id);
    logLoginEvent(provisioned.user, externalId, true);
    const roleReconciliation = await reconcileSamlRoles(provisioned.user, provisioned.identity, profile);
    return { allowed: true, user: provisioned.user, roleReconciliation };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false, reason: "inactive_account", email, externalId };
  }

  logger.info("Linking SAML account to provisioned user", { userId: user.id, email });

  const newIdentity = await storage.authIdentities.create({
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

  const roleReconciliation = await reconcileSamlRoles(linkedUser ?? user, newIdentity, profile);

  return { allowed: true, user: linkedUser, roleReconciliation };
}

/**
 * Reconcile provider-managed roles from the SAML assertion attributes on
 * every successful login. Attributes are passed through in-memory only and
 * never persisted on the user or identity (they can carry PII).
 */
async function reconcileSamlRoles(
  user: { id: string } & Record<string, any>,
  identity: { id: string; metadata: unknown },
  profile: SamlProfile,
): Promise<RoleReconciliationFacts> {
  try {
    const attributes: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(profile)) {
      if (typeof value === "function") continue;
      attributes[key] = value;
    }
    return await reconcileMappedRoles("saml", user as any, identity as any, attributes);
  } catch (error) {
    logger.error("SAML role reconciliation failed", { userId: user.id, error });
    return {
      outcome: "error",
      identityId: identity.id,
      error,
    };
  }
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

/**
 * SAML settings resolved fresh from the env registry. Values set in the
 * Variables table (ENV_SAML_*) apply immediately — no restart — because
 * getEnvironmentVariable consults the override cache on every read (a real,
 * non-empty, non-__UNSET__ process-env value always wins).
 */
interface ResolvedSamlConfig {
  entryPoint: string;
  issuer: string;
  cert: string;
  callbackUrl: string;
}

/**
 * Public origin of this deployment, used for the SAML callback URL and the
 * metadata document. Registry-resolved PUBLIC_URL: explicit value, else the
 * platform domains, else a localhost dev fallback — never undefined.
 */
function samlHostBase(): string {
  return getEnvironmentVariable("PUBLIC_URL")!;
}

class SamlAuthProvider implements AuthProvider {
  type = "saml" as const;

  private config: SamlProviderConfig;

  /** Path the callback route was mounted on (fixed at boot — see setup). */
  private mountedCallbackPath: string = "/api/auth/saml/callback";

  /**
   * Strategy cache key: the resolved (entryPoint, issuer, cert, callbackUrl)
   * tuple that produced the currently-registered passport strategy. When any
   * value changes (e.g. a Variables-table edit), the next request rebuilds
   * the strategy — construction is cheap and logins are rare.
   */
  private strategyKey: string | null = null;

  constructor(config: SamlProviderConfig) {
    this.config = config;
  }

  /**
   * Resolve the SAML variables NOW. Returns the config, or the list of
   * missing variable names when incomplete.
   */
  private resolveConfig():
    | { ok: true; config: ResolvedSamlConfig }
    | { ok: false; missing: string[] } {
    const entryPoint = getEnvironmentVariable("SAML_ENTRY_POINT");
    const issuer = getEnvironmentVariable("SAML_ISSUER");
    const cert = getEnvironmentVariable("SAML_CERT");

    const missing: string[] = [];
    if (!entryPoint) missing.push("SAML_ENTRY_POINT");
    if (!issuer) missing.push("SAML_ISSUER");
    if (!cert) missing.push("SAML_CERT");
    if (missing.length > 0) return { ok: false, missing };

    return {
      ok: true,
      config: {
        entryPoint: entryPoint!,
        issuer: issuer!,
        cert: cert!,
        callbackUrl: `${samlHostBase()}${this.mountedCallbackPath}`,
      },
    };
  }

  /**
   * Ensure the passport strategy reflects the currently-resolved config.
   * Returns the missing-variable list when SAML is not configured; in that
   * case callers redirect to the existing saml_not_configured error page.
   */
  private ensureStrategy(): { ok: true } | { ok: false; missing: string[] } {
    const resolved = this.resolveConfig();
    if (!resolved.ok) return resolved;

    const { entryPoint, issuer, cert, callbackUrl } = resolved.config;
    const key = JSON.stringify([entryPoint, issuer, cert, callbackUrl]);
    if (key === this.strategyKey) return { ok: true };

    passport.use(STRATEGY_NAME, this.buildStrategy(resolved.config));
    this.strategyKey = key;
    logger.info("SAML strategy (re)built from current configuration", {
      service: "saml-auth",
      entryPoint,
      issuer,
      callbackUrl,
    });
    return { ok: true };
  }

  /** Guard wrapper: 503 the flow to the error page when SAML is unconfigured. */
  private withConfiguredStrategy(handler: RequestHandler): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const ensured = this.ensureStrategy();
      if (!ensured.ok) {
        samlMilestone(req, "configuration_unavailable");
        logger.warn("SAML request but SAML is not configured", {
          service: "saml-auth",
          missing: ensured.missing,
          path: req.path,
        });
        return res.redirect("/auth-error?error=saml_not_configured");
      }
      return handler(req, res, next);
    };
  }

  private buildStrategy(resolved: ResolvedSamlConfig): SamlStrategy {
    return new SamlStrategy(
      {
        entryPoint: resolved.entryPoint,
        issuer: resolved.issuer,
        idpCert: resolved.cert,
        callbackUrl: resolved.callbackUrl,
        wantAuthnResponseSigned: false,
        wantAssertionsSigned: true,
        signatureAlgorithm: "sha256",
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        // passReqToCallback lets the verify functions receive req so that
        // recordAccessDenied can capture IP/context and store the reference id
        // on the request for the outer callback handler to read.
        passReqToCallback: true,
      },
      (req: Request, profile: Profile | null, done: (err: Error | null, user?: Record<string, unknown>) => void) => {
        (async () => {
          try {
            if (!profile) {
              return done(null, undefined);
            }
            
            const samlProfile = profile as unknown as SamlProfile;
            samlMilestone(req, "assertion_verified");
            const result = await checkUserAccess(samlProfile);

            if (!result.allowed) {
              // Persist an admin-visible log entry and store the reference on
              // the request so getCallbackHandler can include it in the redirect.
              const reference = recordAccessDenied(result.reason, {
                email: result.email,
                externalId: result.externalId,
              }, req);
              (req as SamlRequest)._samlAccessDenied = { reference, reason: result.reason };
              observeSaml(req, "access_denied", {
                profile: samlProfile,
                matchedEmail: result.email,
                externalId: result.externalId,
              });
              return done(null, undefined);
            }

            const { externalId, email, firstName, lastName } = extractProfileData(samlProfile);

            observeSaml(req, "success", {
              profile: samlProfile,
              matchedEmail: email,
              matchedUserId: result.user?.id,
              externalId,
              roleReconciliation: result.roleReconciliation,
            });

            const sessionUser: AuthenticatedUser = {
              claims: {
                sub: externalId,
                email,
                first_name: firstName,
                last_name: lastName,
              },
              dbUser: result.user,
              providerType: "saml",
            };

            return done(null, sessionUser as unknown as Record<string, unknown>);
          } catch (error) {
            logger.error("SAML authentication error", { error });
            return done(error as Error);
          }
        })();
      },
      (req: Request, profile: Profile | null, done: (err: Error | null, user?: Record<string, unknown>) => void) => {
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
  }

  async setup(app: Express): Promise<void> {
    // The callback route is mounted ONCE, at the path resolved at boot.
    // Changing SAML_CALLBACK_PATH via the Variables table therefore still
    // requires a restart; every other SAML variable is live (request-time).
    this.mountedCallbackPath =
      getEnvironmentVariable("SAML_CALLBACK_PATH") ||
      this.config.callbackPath ||
      "/api/auth/saml/callback";
    const callbackPath = this.mountedCallbackPath;
    setSamlCallbackPath(callbackPath);

    app.post(callbackPath, this.getCallbackHandler());
    // The ACS only accepts SAML assertions via POST. Browsers still arrive
    // here with GET — Okta "Embed link" apps, bookmarked callback URLs, or a
    // redirect-binding misconfiguration — and without this handler the GET
    // fell through to the SPA catch-all and rendered a bare 404 page. Kick
    // those into the normal SP-initiated login instead: it round-trips
    // through the IdP and comes back as a proper POST.
    app.get(callbackPath, (req, res) => {
      if (req.isAuthenticated?.()) return res.redirect("/");
      // An IdP misconfigured to use the Redirect binding delivers its
      // response as GET ?SAMLResponse=... — bouncing that to login would
      // loop forever (login → IdP → same GET). Terminal error instead.
      if (typeof req.query.SAMLResponse === "string") {
        samlMilestone(req, "wrong_binding");
        logger.warn("SAML response received via GET (Redirect binding); ACS requires POST", {
          service: "saml-auth",
        });
        return res.redirect("/auth-error?error=saml_wrong_binding");
      }
      logger.info("GET on SAML callback path; redirecting to SP-initiated login", {
        service: "saml-auth",
      });
      res.redirect("/api/auth/saml/login");
    });

    app.get("/api/auth/saml/metadata", (req, res) => {
      // Metadata reflects the CURRENT configuration (issuer may come from a
      // Variables-table override applied after boot). Fallback to the host
      // base is metadata-display-only; login/callback require SAML_ISSUER.
      const issuer = getEnvironmentVariable("SAML_ISSUER") || samlHostBase();
      const callbackUrl = `${samlHostBase()}${this.mountedCallbackPath}`;
      res.type("application/xml");
      const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${issuer}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${callbackUrl}" index="0"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
      res.send(metadata);
    });

    app.get("/api/auth/saml/login", this.getLoginHandler());
    // A separate same-origin GET proves the browser returned the saved cookie
    // and Passport restored it. logIn already saves; do not save a second time.
    app.get("/api/auth/saml/complete", (req, res) => {
      res.set("Cache-Control", "no-store");
      if (!req.isAuthenticated?.() || !(req.user as AuthenticatedUser)?.dbUser?.id) {
        return samlHandoffFailure(req, res, "saml_session_missing");
      }
      samlMilestone(req, "session_restored", { authenticated: true });
      res.redirect("/");
    });
    app.use(callbackPath, samlHandoffError);
    app.use("/api/auth/saml/complete", samlHandoffError);

    const bootResolved = this.resolveConfig();
    logger.info("SAML auth provider initialized", {
      service: "saml-auth",
      configuredAtBoot: bootResolved.ok,
      missingAtBoot: bootResolved.ok ? undefined : bootResolved.missing,
      callbackPath,
    });
  }

  getLoginHandler(): RequestHandler {
    const handler = this.withConfiguredStrategy((req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(STRATEGY_NAME, {
        additionalParams: {},
      } as any)(req, res, (error?: unknown) => {
        if (error) return samlHandoffFailure(req, res, "saml_handoff_failed");
        next();
      });
    });
    return (req, res, next) => {
      samlMilestone(req, "initiation");
      try { handler(req, res, next); }
      catch { samlHandoffFailure(req, res, "saml_handoff_failed"); }
    };
  }

  getCallbackHandler(): RequestHandler {
    const handler = this.withConfiguredStrategy((req: Request, res: Response, next: NextFunction) => {
      const hasResponse = typeof req.body?.SAMLResponse === "string" && !!req.body.SAMLResponse.trim();
      samlMilestone(req, "verification_started", { hasResponse });
      // Passport-SAML's default fallback initiates a NEW login when no payload
      // is present. At the ACS that hides a broken/truncated handoff.
      if (!hasResponse) return samlHandoffFailure(req, res, "saml_response_missing");
      // Use a custom callback instead of failureRedirect so every failure path
      // goes through recordSamlFailure and receives a reference + category.
      passport.authenticate(
        STRATEGY_NAME,
        { session: false },
        (err: any, user: any, info: any) => {
          if (err) {
            samlMilestone(req, "verification_failed");
            logger.error("SAML callback error", { error: err });
            const { reference, category } = recordSamlFailure("saml_callback_failed", err, req);
            return res.redirect(
              `/auth-error?error=saml_callback_failed&ref=${reference}&category=${category}`,
            );
          }

          if (!user) {
            const denial = (req as SamlRequest)._samlAccessDenied;
            if (denial) {
              samlMilestone(req, "access_denied");
              const params = new URLSearchParams({
                error: "access_denied",
                ref: denial.reference,
              });
              // Only the inactive-account explanation is public. Other
              // account details remain in the original administrator log.
              if (denial.reason === "inactive_account") params.set("category", denial.reason);
              return res.redirect(`/auth-error?${params}`);
            }
            samlMilestone(req, "verification_rejected");
            // Passport rejected the assertion (e.g. signature/timing failure or
            // the verify callback returned done(null, false)). Previously this
            // went straight to failureRedirect with no log entry; now it also
            // goes through the recorder.
            const syntheticErr = new Error(
              (info as any)?.message || "SAML authentication rejected",
            );
            const { reference, category } = recordSamlFailure("saml_failed", syntheticErr, req);
            return res.redirect(
              `/auth-error?error=saml_failed&ref=${reference}&category=${category}`,
            );
          }

          req.logIn(user, { session: true }, (loginErr) => {
            if (loginErr) {
              samlMilestone(req, "session_failed", { authenticated: false });
              logger.error("SAML session login error", { error: loginErr });
              const { reference, category } = recordSamlFailure("session_failed", loginErr, req);
              return res.redirect(
                `/auth-error?error=session_failed&ref=${reference}&category=${category}`,
              );
            }

            samlMilestone(req, "session_established", { authenticated: true });
            res.redirect(303, "/api/auth/saml/complete");
          });
        },
      )(req, res, next);
    });
    return (req, res, next) => {
      try { handler(req, res, next); }
      catch { samlHandoffFailure(req, res, "saml_handoff_failed"); }
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
