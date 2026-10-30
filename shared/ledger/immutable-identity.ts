/** Identity echoes are accepted for older clients; they are not edit permissions. */
export const EA_IDENTITY_FIELDS = ["entityType", "entityId", "accountId"] as const;
export const ACCOUNT_IDENTITY_FIELDS = ["currencyCode"] as const;
export const EA_IDENTITY_MESSAGE =
  "An entity account's participant type, participant ID, and ledger account are permanent after creation. Review historical corrections with authorized staff.";
export const ACCOUNT_CURRENCY_MESSAGE =
  "Account currency is permanent after creation. Choose the correct currency when creating an account.";

export class LedgerIdentityConflict extends Error {
  readonly code = "LEDGER_IDENTITY_IMMUTABLE";
}

export function assertUnchangedLedgerIdentity(
  existing: object,
  patch: object,
  fields: readonly string[],
  message: string,
): void {
  const oldValues = existing as Record<string, unknown>;
  const newValues = patch as Record<string, unknown>;
  if (fields.some(field => newValues[field] !== undefined && newValues[field] !== oldValues[field])) {
    throw new LedgerIdentityConflict(message);
  }
}

/** PostgreSQL/Drizzle may wrap a trigger exception in a query error. */
export function ledgerIdentityConflictMessage(error: unknown): string | undefined {
  if (error instanceof LedgerIdentityConflict) return error.message;
  let current = error as { code?: string; constraint?: string; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current.code === "23514") {
      if (current.constraint === "ledger_ea_identity_immutable") return EA_IDENTITY_MESSAGE;
      if (current.constraint === "ledger_accounts_currency_immutable") return ACCOUNT_CURRENCY_MESSAGE;
    }
    current = current.cause as typeof current;
  }
  return undefined;
}
