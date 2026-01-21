import { Strategy as GoogleStrategy, Profile, VerifyCallback } from "passport-google-oauth20";
import passport from "passport";
import type { Express } from "express";
import { storage } from "../storage";
import { logger } from "../logger";
import type { AuthProviderType } from "@shared/schema";

const PROVIDER_TYPE: AuthProviderType = "oauth";

export function isGoogleConfigured(): boolean {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_CALLBACK_URL
  );
}

export async function setupGoogleAuth(app: Express): Promise<boolean> {
  if (!isGoogleConfigured()) {
    logger.info("Google OAuth not configured - missing environment variables", {
      source: "auth",
      required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_CALLBACK_URL"],
    });
    
    app.get("/api/auth/google", (_req, res) => {
      res.status(503).json({ message: "Google OAuth not configured." });
    });
    app.get("/api/auth/google/callback", (_req, res) => {
      res.status(503).json({ message: "Google OAuth not configured." });
    });
    
    return false;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        callbackURL: process.env.GOOGLE_CALLBACK_URL!,
        scope: ["profile", "email"],
      },
      async (
        accessToken: string,
        refreshToken: string,
        profile: Profile,
        done: VerifyCallback
      ) => {
        try {
          const externalId = profile.id;
          const email = profile.emails?.[0]?.value;
          const displayName = profile.displayName;
          const firstName = profile.name?.givenName;
          const lastName = profile.name?.familyName;

          if (!email) {
            return done(new Error("Email not provided by Google"), undefined);
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
                firstName: firstName || displayName?.split(" ")[0] || null,
                lastName: lastName || displayName?.split(" ").slice(1).join(" ") || null,
                isActive: true,
              });
              
              logger.info("Created new user from Google OAuth", {
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

            logger.info("Linked Google identity to user", {
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
          logger.error("Google OAuth error", {
            source: "auth",
            error: error instanceof Error ? error.message : "Unknown error",
          });
          return done(error as Error, undefined);
        }
      }
    )
  );

  app.get(
    "/api/auth/google",
    passport.authenticate("google", { scope: ["profile", "email"] })
  );

  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { failureRedirect: "/login?error=google_failed" }),
    (req, res) => {
      logger.info("Google OAuth login successful", {
        source: "auth",
        user: (req.user as any)?.claims?.email,
      });
      res.redirect("/");
    }
  );

  logger.info("Google OAuth configured", {
    source: "auth",
    callbackUrl: process.env.GOOGLE_CALLBACK_URL,
  });

  return true;
}
