import { sql } from "drizzle-orm";
import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";
import { databaseSourceInfo } from "../../../../storage/db";

/**
 * Describe the database connection the app ACTUALLY uses, without leaking
 * credentials. Derived from the boot-time resolved target in
 * server/storage/db.ts (single source of truth: EXTERNAL_DATABASE_URL wins
 * over DATABASE_URL, Neon pooler rewrite applied) — never from a direct
 * process.env read, which previously reported the Replit-injected
 * DATABASE_URL even when the app was connected elsewhere.
 */
function describeConnection(): string {
  const { driver, host, database, source } = databaseSourceInfo;
  return `driver=${driver}, host=${host}, database=${database} (from ${source})`;
}

registerSystemStatusPlugin({
  id: "database.connection",
  name: "Database Connection",
  description: "Verifies the database is reachable and reports driver and host info.",
  needsReadOnlyDb: true,
  async scan(): Promise<StatusMessage[]> {
    const info = describeConnection();
    const { storage } = await import("../../../../storage");
    try {
      await storage.readOnly.query(async (client) => {
        await client.execute(sql`SELECT 1`);
      });
      return [
        {
          priority: "info",
          title: "Connected",
          details: info,
        },
      ];
    } catch (error) {
      return [
        {
          priority: "error",
          title: "Database connection failed",
          details: `${info} — ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
  },
});
