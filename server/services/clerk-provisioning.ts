import { createClerkClient } from "@clerk/express";
import { storage } from "../storage";
import { logger } from "../logger";

export interface ClerkConflictCheckResult {
  configured: boolean;
  conflict: boolean;
  conflictUserId?: string;
  existingClerkUserId?: string;
}

export interface ClerkProvisioningResult {
  success: boolean;
  clerkUserId?: string;
  warning?: string;
}

function getClerkClient() {
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const clerkPublishableKey = process.env.CLERK_PUBLISHABLE_KEY || process.env.VITE_CLERK_PUBLISHABLE_KEY;
  if (!clerkSecretKey || !clerkPublishableKey) return null;
  return createClerkClient({ secretKey: clerkSecretKey, publishableKey: clerkPublishableKey });
}

export async function checkClerkConflict(email: string): Promise<ClerkConflictCheckResult> {
  const clerk = getClerkClient();
  if (!clerk) return { configured: false, conflict: false };

  try {
    const existingClerkUsers = await clerk.users.getUserList({
      emailAddress: [email],
    });

    if (existingClerkUsers.data.length > 0) {
      const existingClerkUser = existingClerkUsers.data[0];
      const existingIdentity = await storage.authIdentities.getByProviderAndExternalId("clerk", existingClerkUser.id);

      if (existingIdentity) {
        logger.warn("Clerk account already linked to another user", {
          email,
          clerkUserId: existingClerkUser.id,
          existingUserId: existingIdentity.userId,
        });
        return {
          configured: true,
          conflict: true,
          conflictUserId: existingIdentity.userId,
        };
      }

      return {
        configured: true,
        conflict: false,
        existingClerkUserId: existingClerkUser.id,
      };
    }
  } catch (lookupErr) {
    logger.warn("Failed to look up existing Clerk user, proceeding with creation", {
      email,
      error: lookupErr,
    });
  }

  return { configured: true, conflict: false };
}

export async function provisionClerkAccount(params: {
  userId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  existingClerkUserId?: string;
}): Promise<ClerkProvisioningResult> {
  const { userId, email, firstName, lastName, existingClerkUserId } = params;

  const clerk = getClerkClient();
  if (!clerk) {
    return {
      success: false,
      warning: "Clerk is not configured. User will need to sign up manually.",
    };
  }

  let clerkUserId = existingClerkUserId;

  try {
    if (!clerkUserId) {
      const baseUsername = email.split("@")[0].replace(/[^a-zA-Z0-9_-]/g, "_").toLowerCase();
      const username = `${baseUsername}_${Date.now().toString(36)}`;

      const newClerkUser = await clerk.users.createUser({
        emailAddress: [email],
        username,
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
    const errorDetails = {
      message: clerkErr?.message,
      status: clerkErr?.status,
      clerkError: clerkErr?.errors || clerkErr?.clerkError,
      code: clerkErr?.code,
      raw: JSON.stringify(clerkErr, Object.getOwnPropertyNames(clerkErr || {})),
    };
    logger.error("Failed to create/link Clerk account for provisioned user", {
      userId,
      email,
      ...errorDetails,
    });
    return {
      success: false,
      warning: `Clerk account could not be created automatically: ${clerkErr?.message || 'Unknown error'}. User will need to sign up manually.`,
    };
  }
}
