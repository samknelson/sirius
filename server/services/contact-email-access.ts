import type { Request, Response } from "express";
import type { User } from "@shared/schema";
import { isContactEmailConflict } from "@shared/utils/contact-email";
import { storage } from "../storage";
import { buildContext, checkAccess } from "./access-policy-evaluator";

class ContactEmailRefusal extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function getActor(req: Request): Promise<User> {
  const { user } = await buildContext(req);
  if (!user) throw new ContactEmailRefusal(401, "Authentication required");
  return user;
}

async function isStaff(user: User): Promise<boolean> {
  // Do not delegate this identity-sensitive decision to the cached staff policy.
  return await storage.users.userHasPermission(user.id, "staff")
    || await storage.users.userHasPermission(user.id, "admin");
}

/** A new destination is never evidence of ownership of the existing contact. */
export async function assertContactEmailDestination(req: Request, email: string | null): Promise<void> {
  const user = await getActor(req);
  if (!email || await isStaff(user)) return;
  if (await storage.users.hasOtherUserWithEmail(email, user.id)) {
    throw new ContactEmailRefusal(409, "This email cannot be assigned to this contact");
  }
}

export async function assertContactEmailChange(req: Request, contactId: string, email: string | null): Promise<void> {
  const user = await getActor(req);
  const access = await checkAccess("contact.email.edit", user, contactId);
  if (!access.granted) throw new ContactEmailRefusal(403, access.reason || "Email changes are not permitted");
  await assertContactEmailDestination(req, email);
}

/** Employer management alone does not authorize linking a foreign identity. */
export async function assertContactEmailLink(req: Request, contactId: string, employerId: string): Promise<void> {
  const user = await getActor(req);
  if (await isStaff(user)) return;
  const links = await storage.employerContacts.listByContactId(contactId);
  if (links.some(link => link.employerId === employerId)) {
    throw new ContactEmailRefusal(409, "This contact is already linked to this employer");
  }
  const ownContact = await storage.contacts.getContactByEmail(user.email);
  if (ownContact?.id !== contactId) {
    throw new ContactEmailRefusal(403, "An administrator must link an existing contact belonging to someone else");
  }
}

export function respondContactEmailError(res: Response, error: unknown): boolean {
  if (error instanceof ContactEmailRefusal) {
    res.status(error.status).json({ message: error.message });
    return true;
  }
  if (isContactEmailConflict(error)) {
    res.status(409).json({ message: "A contact with this email already exists." });
    return true;
  }
  return false;
}
