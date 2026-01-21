import { Strategy as OAuth2Strategy } from "passport-oauth2";
import passport from "passport";
import type { Express } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import type { AuthProviderType } from "@shared/schema";

const PROVIDER_TYPE: AuthProviderType = "oauth";

export function isCognitoConfigured(): boolean {
  return !!(
    process.env.COGNITO_USER_POOL_ID &&
    process.env.COGNITO_CLIENT_ID &&
    process.env.COGNITO_CLIENT_SECRET &&
    process.env.COGNITO_DOMAIN &&
    process.env.COGNITO_CALLBACK_URL
  );
}

function getCognitoUrls() {
  const domain = process.env.COGNITO_DOMAIN;
  const region = process.env.COGNITO_REGION || "us-east-1";
  
  const baseUrl = domain?.includes(".amazoncognito.com") 
    ? `https://${domain}`
    : `https://${domain}.auth.${region}.amazoncognito.com`;
  
  return {
    authorizationURL: `${baseUrl}/oauth2/authorize`,
    tokenURL: `${baseUrl}/oauth2/token`,
    userInfoURL: `${baseUrl}/oauth2/userInfo`,
    logoutURL: `${baseUrl}/logout`,
  };
}

export async function setupCognitoAuth(app: Express): Promise<boolean> {
  if (!isCognitoConfigured()) {
    logger.info("AWS Cognito not configured - missing environment variables", {
      source: "auth",
      required: [
        "COGNITO_USER_POOL_ID",
        "COGNITO_CLIENT_ID", 
        "COGNITO_CLIENT_SECRET",
        "COGNITO_DOMAIN",
        "COGNITO_CALLBACK_URL"
      ],
    });
    
    app.get("/api/auth/cognito", (_req, res) => {
      res.status(503).json({ message: "AWS Cognito not configured." });
    });
    app.get("/api/auth/cognito/callback", (_req, res) => {
      res.status(503).json({ message: "AWS Cognito not configured." });
    });
    
    return false;
  }

  const urls = getCognitoUrls();
  
  passport.use(
    "cognito",
    new OAuth2Strategy(
      {
        authorizationURL: urls.authorizationURL,
        tokenURL: urls.tokenURL,
        clientID: process.env.COGNITO_CLIENT_ID!,
        clientSecret: process.env.COGNITO_CLIENT_SECRET!,
        callbackURL: process.env.COGNITO_CALLBACK_URL!,
        scope: ["openid", "email", "profile"],
      },
      async (
        accessToken: string,
        refreshToken: string,
        params: any,
        profile: any,
        done: (err: Error | null, user?: any) => void
      ) => {
        try {
          const userInfoResponse = await fetch(urls.userInfoURL, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          });

          if (!userInfoResponse.ok) {
            throw new Error("Failed to fetch user info from Cognito");
          }

          const userInfo = await userInfoResponse.json();
          
          const externalId = userInfo.sub;
          const email = userInfo.email;
          const firstName = userInfo.given_name || userInfo.name?.split(" ")[0];
          const lastName = userInfo.family_name || userInfo.name?.split(" ").slice(1).join(" ");
          const displayName = userInfo.name || `${firstName} ${lastName}`.trim();

          if (!email) {
            return done(new Error("Email not provided by Cognito"), undefined);
          }

          let authIdentity = await storage.authIdentities.getByProviderAndExternalId(
            PROVIDER_TYPE,
            externalId
          );

          let user;

          if (authIdentity) {
            user = await storage.users.getUser(authIdentity.userId);
            await storage.authIdentities.updateLastUsed(authIdentity.id);
          } else {
            user = await storage.users.getUserByEmail(email);

            if (!user) {
              user = await storage.users.createUser({
                email,
                firstName: firstName || null,
                lastName: lastName || null,
                isActive: true,
              });
              
              logger.info("Created new user from Cognito", {
                source: "auth",
                userId: user.id,
                email,
              });
            }

            authIdentity = await storage.authIdentities.create({
              userId: user.id,
              providerType: PROVIDER_TYPE,
              externalId,
              email,
              displayName,
            });

            logger.info("Linked Cognito identity to user", {
              source: "auth",
              userId: user.id,
              identityId: authIdentity.id,
            });
          }

          if (!user) {
            return done(new Error("User not found"), undefined);
          }

          const sessionUser = {
            claims: {
              sub: externalId,
              email,
              first_name: user.firstName,
              last_name: user.lastName,
            },
            providerType: PROVIDER_TYPE,
          };

          return done(null, sessionUser);
        } catch (error) {
          logger.error("Cognito OAuth error", {
            source: "auth",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          return done(error as Error, undefined);
        }
      }
    )
  );

  app.get(
    "/api/auth/cognito",
    passport.authenticate("cognito", { 
      scope: ["openid", "email", "profile"],
      callbackURL: process.env.COGNITO_CALLBACK_URL,
    })
  );

  app.get(
    "/api/auth/cognito/callback",
    passport.authenticate("cognito", { failureRedirect: "/login?error=cognito_failed" }),
    (req, res) => {
      logger.info("Cognito OAuth login successful", {
        source: "auth",
        user: (req.user as any)?.claims?.email,
      });
      res.redirect("/");
    }
  );

  app.get("/api/auth/cognito/logout", (req, res) => {
    const clientId = process.env.COGNITO_CLIENT_ID;
    const logoutUri = process.env.COGNITO_LOGOUT_URL || process.env.COGNITO_CALLBACK_URL?.replace("/callback", "");
    
    req.logout((err) => {
      if (err) {
        logger.error("Logout error", { source: "auth", error: err.message });
      }
      
      const cognitoLogoutUrl = `${urls.logoutURL}?client_id=${clientId}&logout_uri=${encodeURIComponent(logoutUri || "/")}`;
      res.redirect(cognitoLogoutUrl);
    });
  });

  logger.info("AWS Cognito OAuth configured", {
    source: "auth",
    domain: process.env.COGNITO_DOMAIN,
    callbackUrl: process.env.COGNITO_CALLBACK_URL,
  });

  return true;
}
