import { withStorageLogging } from '../../../../../storage/middleware/logging';

import { getClient } from '../../../../../storage/transaction-context';
import { users } from "@shared/schema";

import { eq, and, sql } from "drizzle-orm";

import { defineLoggingConfig } from "../../../../../storage/middleware/logging";

export interface S1UserOperations {

  retireMigratedUserEmail(id: string, expectedEmail: string, retiredEmail: string): Promise<boolean>;
}

export function createS1UserOperations(): S1UserOperations {
  return {

    /**
     * Release a unique login address from an already-inactive migrated
     * account without propagating the account-only tombstone to contacts.
     * The expected-email predicate makes the migration's collision check and
     * write fail closed if the row changed in between.
     */
    async retireMigratedUserEmail(
      id: string,
      expectedEmail: string,
      retiredEmail: string,
    ): Promise<boolean> {
      const client = getClient();
      const result = await client
        .update(users)
        .set({ email: retiredEmail })
        .where(and(
          eq(users.id, id),
          eq(users.isActive, false),
          sql`lower(${users.email}) = lower(${expectedEmail})`,
        ))
        .returning({ id: users.id });
      return result.length === 1;
    }
  };
}

const loggingConfig = defineLoggingConfig<S1UserOperations>({module: 'users',
table: 'users', methods: {
    retireMigratedUserEmail: {
      logArgs: (args) => [args[0], "<expected email redacted>", "<retired email redacted>"],
      getHostEntityId: (args) => args[0],
      getDescription: (args, result) =>
        result
          ? `Retired migration-owned login email for inactive user ${args[0]}`
          : `Did not retire migration-owned login email for inactive user ${args[0]}`,
    }}});

export const s1Users = withStorageLogging(createS1UserOperations(), loggingConfig);
