import type { Express, Request } from "express";
import { z } from "zod";
import type { AuthProviderType } from "@shared/schema";
import { storage } from "../storage";
import { logger } from "../logger";
import { parseSSN } from "@shared/utils/ssn";

export interface VerifiedWorkerSession {
  workerId: string;
  contactId: string;
  verifiedAt: number;
}

const VERIFIED_WORKER_TTL_MS = 30 * 60 * 1000;

export function isWorkerSelfRegistrationEnabled(): boolean {
  const v = process.env.AUTH_WORKER_SELF_REGISTRATION;
  if (v === undefined || v === "") return true;
  const lower = v.toLowerCase();
  return lower === "true" || lower === "1" || lower === "yes" || lower === "on";
}

export function getVerifiedWorker(req: Request): VerifiedWorkerSession | null {
  const v = (req.session as any)?.verifiedWorker;
  if (!v?.workerId) return null;
  const elapsed = Date.now() - (v.verifiedAt || 0);
  if (elapsed > VERIFIED_WORKER_TTL_MS) return null;
  return v as VerifiedWorkerSession;
}

export function clearVerifiedWorker(req: Request): void {
  if (req.session) {
    delete (req.session as any).verifiedWorker;
  }
}

export async function clearVerifiedWorkerAndSave(req: Request): Promise<void> {
  if (!req.session) return;
  delete (req.session as any).verifiedWorker;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

export interface LinkWorkerArgs {
  providerType: AuthProviderType;
  externalId: string;
  workerId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileImageUrl?: string | null;
  displayName?: string;
}

export interface LinkedWorkerResult {
  user: any;
  worker: any;
  contact: any;
  emailUsed: string;
  alreadyLinked: boolean;
  created: boolean;
}

/**
 * Provider-agnostic worker linking. Finds-or-creates the Sirius user for the
 * given worker, assigns the worker role + tenant-required roles, creates the
 * auth_identities row tagged with the workerId, and syncs the contact email
 * to whatever the IdP returned (IdP wins when an email is present).
 *
 * Idempotent: if an auth_identities row already exists for
 * (providerType, externalId), no new row is created and `alreadyLinked: true`
 * is returned.
 */
export async function linkWorkerToAuthIdentity(
  args: LinkWorkerArgs
): Promise<LinkedWorkerResult> {
  const { providerType, externalId, workerId } = args;

  const worker = await storage.workers.getWorker(workerId);
  if (!worker) {
    throw new Error(`Worker not found: ${workerId}`);
  }
  const contact = await storage.contacts.getContact(worker.contactId);
  if (!contact) {
    throw new Error(`Contact not found for worker: ${workerId}`);
  }

  const idpEmail =
    typeof args.email === "string" && args.email.trim()
      ? args.email.trim()
      : null;
  const contactEmail = (contact.email || "").trim() || null;
  const emailUsed = idpEmail || contactEmail;

  if (!emailUsed) {
    throw new Error(
      "No email available from IdP or contact for worker linking"
    );
  }

  let user = await storage.users.getUserByEmail(emailUsed);
  if (!user && contactEmail && contactEmail !== emailUsed) {
    user = await storage.users.getUserByEmail(contactEmail);
  }

  let created = false;
  if (!user) {
    user = await storage.users.createUser({
      email: emailUsed,
      firstName: contact.given || args.firstName || "",
      lastName: contact.family || args.lastName || "",
      isActive: true,
      accountStatus: "active",
    });
    created = true;
  } else if (!user.isActive) {
    throw new Error("User account is deactivated");
  }

  const workerRole = await storage.users.getRoleByName("worker");
  if (workerRole) {
    const currentRoles = await storage.users.getUserRoles(user.id);
    if (!currentRoles.some((r: any) => r.id === workerRole.id)) {
      await storage.users.assignRoleToUser({
        userId: user.id,
        roleId: workerRole.id,
      });
    }
  }

  const requiredVariable = await storage.variables.getByName(
    "worker_user_roles_required"
  );
  const requiredRoleIds: string[] = (
    Array.isArray(requiredVariable?.value) ? requiredVariable!.value : []
  ) as string[];
  if (requiredRoleIds.length > 0) {
    const currentRoles = await storage.users.getUserRoles(user.id);
    const currentRoleIds = currentRoles.map((r: any) => r.id);
    for (const roleId of requiredRoleIds) {
      if (!currentRoleIds.includes(roleId)) {
        await storage.users.assignRoleToUser({ userId: user.id, roleId });
      }
    }
  }

  const existingIdentity =
    await storage.authIdentities.getByProviderAndExternalId(
      providerType,
      externalId
    );

  let alreadyLinked = false;
  if (!existingIdentity) {
    await storage.authIdentities.create({
      userId: user.id,
      providerType,
      externalId,
      email: emailUsed,
      displayName:
        args.displayName ||
        `${args.firstName || ""} ${args.lastName || ""}`.trim() ||
        undefined,
      profileImageUrl: args.profileImageUrl || undefined,
      metadata: { workerId: worker.id },
    });
  } else {
    alreadyLinked = true;
  }

  const linkedUser = await storage.users.updateUser(user.id, {
    email: emailUsed,
    firstName: contact.given || args.firstName || undefined,
    lastName: contact.family || args.lastName || undefined,
    profileImageUrl: args.profileImageUrl || undefined,
    accountStatus: "linked",
  });

  if (idpEmail && idpEmail !== contactEmail) {
    try {
      await storage.contacts.updateEmail(worker.contactId, idpEmail);
      logger.info("Synced IdP email to worker contact", {
        providerType,
        workerId: worker.id,
        contactId: worker.contactId,
        previousEmail: contactEmail || "(none)",
        newEmail: idpEmail,
      });
    } catch (err) {
      logger.warn("Failed to sync IdP email to worker contact", {
        providerType,
        workerId: worker.id,
        error: err,
      });
    }
  }

  await storage.users.updateUserLastLogin(user.id);

  return {
    user: linkedUser || user,
    worker,
    contact,
    emailUsed,
    alreadyLinked,
    created,
  };
}

const verifyWorkerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  ssn: z.string().min(1, "SSN is required"),
  dateOfBirth: z.string().min(1, "Date of birth is required"),
});

export interface RegisterPreVerifyOptions {
  providerType: AuthProviderType;
}

/**
 * Registers `POST /api/auth/pre-verify-worker`. Each auth provider that
 * supports worker self-registration calls this from its `setup()`. Because
 * each tenant runs exactly one auth provider, only one registration ever
 * runs.
 */
export function registerPreVerifyWorkerRoute(
  app: Express,
  options: RegisterPreVerifyOptions
): void {
  app.post("/api/auth/pre-verify-worker", async (req, res) => {
    try {
      if (!isWorkerSelfRegistrationEnabled()) {
        return res.status(403).json({
          message:
            "Worker self-registration is not enabled. Please contact your administrator.",
        });
      }

      if (req.isAuthenticated?.() && req.user) {
        return res.status(400).json({ message: "Already provisioned" });
      }

      const validation = verifyWorkerSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({
          message: "Invalid input",
          errors: validation.error.errors.map((e) => e.message),
        });
      }

      const { firstName, lastName, ssn, dateOfBirth } = validation.data;

      let normalizedSSN: string;
      try {
        normalizedSSN = parseSSN(ssn);
      } catch {
        return res.status(400).json({ message: "Invalid SSN format" });
      }

      const worker = await storage.workers.getWorkerBySSN(normalizedSSN);
      if (!worker) {
        logger.info("Worker pre-verification failed: no worker for SSN", {
          providerType: options.providerType,
        });
        return res.status(404).json({
          message:
            "We could not verify your identity. Please check your information and try again, or contact your administrator.",
        });
      }

      const contact = await storage.contacts.getContact(worker.contactId);
      if (!contact) {
        logger.warn("Worker pre-verification failed: contact not found", {
          workerId: worker.id,
          contactId: worker.contactId,
        });
        return res.status(404).json({
          message:
            "We could not verify your identity. Please contact your administrator.",
        });
      }

      const fnMatch =
        (contact.given || "").toLowerCase().trim() ===
        firstName.toLowerCase().trim();
      const lnMatch =
        (contact.family || "").toLowerCase().trim() ===
        lastName.toLowerCase().trim();
      const dobMatch = contact.birthDate === dateOfBirth;

      if (!fnMatch || !lnMatch || !dobMatch) {
        logger.info("Worker pre-verification failed: field mismatch", {
          workerId: worker.id,
          fnMatch,
          lnMatch,
          dobMatch,
        });
        return res.status(404).json({
          message:
            "We could not verify your identity. Please check your information and try again, or contact your administrator.",
        });
      }

      const existingUser = contact.email
        ? await storage.users.getUserByEmail(contact.email)
        : null;
      if (existingUser) {
        const identities = await storage.authIdentities.getByUserId(
          existingUser.id
        );
        if (
          identities.some((i: any) => i.providerType === options.providerType)
        ) {
          logger.info("Worker pre-verification blocked: already registered", {
            workerId: worker.id,
            providerType: options.providerType,
          });
          return res.status(409).json({
            message:
              "This worker already has an account. Please use the Sign In button instead.",
          });
        }
      }

      (req.session as any).verifiedWorker = {
        workerId: worker.id,
        contactId: worker.contactId,
        verifiedAt: Date.now(),
      };

      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => (err ? reject(err) : resolve()));
      });

      logger.info("Worker pre-verification successful", {
        workerId: worker.id,
        providerType: options.providerType,
      });

      res.json({
        success: true,
        verified: true,
        workerName: `${contact.given || ""} ${contact.family || ""}`.trim(),
        contactEmail: contact.email || "",
      });
    } catch (error) {
      logger.error("Worker pre-verification error", { error });
      res
        .status(500)
        .json({ message: "An unexpected error occurred. Please try again." });
    }
  });
}
