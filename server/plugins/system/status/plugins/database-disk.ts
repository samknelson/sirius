import { sql } from "drizzle-orm";
import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage } from "../types";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

registerSystemStatusPlugin({
  id: "database.disk",
  name: "Database Storage",
  description: "Table count and total database storage usage.",
  needsReadOnlyDb: true,
  async scan(): Promise<StatusMessage[]> {
    const { storage } = await import("../../../../storage");
    const { tableCount, sizeBytes } = await storage.readOnly.query(
      async (client) => {
        const tables = await client.execute(
          sql`SELECT count(*)::int AS table_count
              FROM information_schema.tables
              WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
        );
        const size = await client.execute(
          sql`SELECT pg_database_size(current_database())::bigint AS size_bytes`,
        );
        const tableRow = (tables as { rows?: Array<Record<string, unknown>> }).rows?.[0];
        const sizeRow = (size as { rows?: Array<Record<string, unknown>> }).rows?.[0];
        return {
          tableCount: Number(tableRow?.table_count ?? NaN),
          sizeBytes: Number(sizeRow?.size_bytes ?? NaN),
        };
      },
    );
    return [
      {
        priority: "info",
        title: `${Number.isFinite(tableCount) ? tableCount : "?"} tables, ${formatBytes(sizeBytes)} used`,
        details: `The database contains ${Number.isFinite(tableCount) ? tableCount : "an unknown number of"} tables using ${formatBytes(sizeBytes)} of storage.`,
      },
    ];
  },
});
