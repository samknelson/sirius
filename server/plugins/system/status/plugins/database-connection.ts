import { sql } from "drizzle-orm";
import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";

/**
 * Describe the configured database connection WITHOUT leaking credentials:
 * only the driver family, host, port, and database name are surfaced.
 */
function describeConnection(): string {
  const url = process.env.DATABASE_URL;
  if (!url) return "DATABASE_URL is not set";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    const override = process.env.DATABASE_DRIVER;
    const driver =
      override === "neon" || override === "pg"
        ? override
        : host.endsWith(".neon.tech") || host.includes(".neon.")
          ? "neon"
          : "pg";
    const dbName = parsed.pathname.replace(/^\//, "") || "(unnamed)";
    const port = parsed.port ? `:${parsed.port}` : "";
    return `driver=${driver}, host=${host}${port}, database=${dbName}`;
  } catch {
    return "DATABASE_URL is set but could not be parsed";
  }
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
