import { createClerkClient } from "@clerk/express";
import { storage } from "../storage";
import { logger } from "../logger";

export interface ClerkProvisioningResult {
  success: boolean;
  clerkUserId?: string;
  warning?: string;
  conflictUserId?: string;
}

export async function provisionClerkAccount(params: {
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<ClerkProvisioningResult> {
  const { userId, email, firstName, lastName } = params;

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;

  if (!clerkSecretKey || !clerkPublishableKey) {
    return {
      success: false,
      warning: "Clerk is not configured. User will need to sign up manually.",
    };
  }

  const clerk = createClerkClient({ secretKey: clerkSecretKey, publishableKey: clerkPublishableKey });

  let clerkUserId: string | undefined;

  try {
    const existingClerkUsers = await clerk.users.getUserList({
      emailAddress: [email],
    });

    if (existingClerkUsers.data.length > 0) {
      const existingClerkUser = existingClerkUsers.data[0];
      const existingIdentity = await storage.authIdentities.getByProviderAndExternalId("clerk", existingClerkUser.id);

      if (existingIdentity && existingIdentity.userId !== userId) {
        logger.warn("Clerk account already linked to another user", {
          email,
          clerkUserId: existingClerkUser.id,
          existingUserId: existingIdentity.userId,
          requestedUserId: userId,
        });
        return {
          success: false,
          warning: "This email is already associated with a Clerk account linked to another user.",
          conflictUserId: existingIdentity.userId,
        };
      }

      if (existingIdentity && existingIdentity.userId === userId) {
        logger.info("Clerk account already linked to this user", {
          userId,
          clerkUserId: existingClerkUser.id,
        });
        return { success: true, clerkUserId: existingClerkUser.id };
      }

      clerkUserId = existingClerkUser.id;
      logger.info("Found existing unlinked Clerk account", {
        userId,
        clerkUserId: existingClerkUser.id,
        email,
      });
    }
  } catch (lookupErr) {
    logger.warn("Failed to look up existing Clerk user, proceeding with creation", {
      email,
      error: lookupErr,
    });
  }

  try {
    if (!clerkUserId) {
      const newClerkUser = await clerk.users.createUser({
        emailAddress: [email],
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        skipPasswordChecks: true,
        skipPasswordRequirement: true,
      });
      clerkUserId = newClerkUser.id;
      logger.info("Created Clerk account for provisioned user", {
        userId,
        clerkUserId: newClerkUser.id,
        email,
      });
    }

    await storage.authIdentities.create({
      userId,
      providerType: "clerk",
      externalId: clerkUserId,
      email,
      displayName: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
    });

    await storage.users.updateUser(userId, {
      accountStatus: "linked",
    });

    logger.info("Auth identity linked for provisioned user", {
      userId,
      clerkUserId,
    });

    return { success: true, clerkUserId };
  } catch (clerkErr: any) {
    logger.error("Failed to create/link Clerk account for provisioned user", {
      userId,
      email,
      error: clerkErr?.message || clerkErr,
    });
    return {
      success: false,
      warning: "Clerk account could not be created automatically. User will need to sign up manually.",
    };
  }
}
