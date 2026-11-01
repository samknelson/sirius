/** Trim for storage/display; the database folds case for identity comparisons. */
export function normalizeUserEmail(email: string): string {
  return email.trim();
}

export function isUserEmailConflict(error: unknown): boolean {
  const e = error as { code?: string; constraint?: string; cause?: unknown } | null;
  return !!e && ((e.code === "23505"
    && ["users_email_unique", "users_email_normalized_unique"].includes(e.constraint || ""))
    || (!!e.cause && e.cause !== error && isUserEmailConflict(e.cause)));
}

/** No arbitrary winner may be used for login, linking, or role assignment. */
export class AmbiguousUserEmailError extends Error {
  constructor(public readonly accountIds: string[]) {
    super(`Ambiguous login email: resolve user account IDs ${accountIds.join(", ")} before retrying. No account was selected.`);
    this.name = "AmbiguousUserEmailError";
  }
}
