import { z } from "zod";

export const contactEmailInput = z.string().trim()
  .pipe(z.union([z.string().email(), z.literal("")])).nullable()
  .transform(email => normalizeContactEmail(email));

/** Preserve display casing; identity comparisons use the same trimmed, folded key. */
export function normalizeContactEmail(email: string | null | undefined): string | null {
  return email?.trim() || null;
}

export function isContactEmailConflict(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; cause?: unknown } | null;
  return !!e && ((e.code === "23505"
    && ["contacts_email_unique", "contacts_email_normalized_unique"].includes(e.constraint || ""))
    || (!!e.cause && e.cause !== error && isContactEmailConflict(e.cause)));
}
