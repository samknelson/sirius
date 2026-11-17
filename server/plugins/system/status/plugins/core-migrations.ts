import { registerSystemStatusPlugin } from "../registry";
import type { StatusMessage, SystemStatusPlugin } from "../types";

const WATERMARK_NOTE =
  "The database version is a watermark, not per-script execution history. Covered scripts may have been bypassed by fresh-schema initialization or operator recovery; individual execution times and success/failure history are not recorded.";
const BUILD_NOTE =
  "Only core scripts registered in this running build are known. An older deployment cannot detect scripts that were never deployed. Component-specific migrations are not included.";

async function snapshot() {
  // Lazy imports avoid adding a migration-runner/storage edge to status boot.
  const [{ storage }, { getMigrations }] = await Promise.all([
    import("../../../../storage"),
    import("../../../../services/migration-runner"),
  ]);
  const variable = await storage.variables.getByName("migrations_version");
  const migrations = getMigrations().sort((a, b) => b.version - a.version);
  const raw = variable?.value;
  const version = typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0 ? raw : null;
  const databaseLabel = !variable ? "Missing migrations_version" :
    version === null ? "Invalid migrations_version (expected a non-negative integer)" : String(version);
  const highest = migrations[0]?.version ?? null;
  const pending = version === null ? null : migrations.filter(m => m.version > version);
  return { migrations, version, databaseLabel, highest, pending };
}

function summary(state: Awaited<ReturnType<typeof snapshot>>): StatusMessage[] {
  const { version, databaseLabel, highest, pending } = state;
  const messages: StatusMessage[] = [{
    priority: version === null || highest === null || version !== highest ? "warning" : "info",
    title: version === null ? databaseLabel :
      highest === null ? "No core migration scripts registered in this build" :
      version < highest ? "Database migration version is behind this running build" :
      version > highest ? "Database migration version is ahead of this running build" :
      "Database migration version matches this running build",
    details: `Database version: ${databaseLabel}. Latest registered core version in this build: ${highest ?? "none"}. Pending core migrations: ${pending?.length ?? "unknown"}.`,
  }];
  if (pending?.length) {
    messages.push({
      priority: "warning",
      title: `${pending.length} pending core migration(s)`,
      details: pending.map(m => `${m.version}: ${m.name}`).join("\n"),
    });
  }
  if (highest === null && version === null) {
    messages.push({ priority: "warning", title: "No core migration scripts registered in this build" });
  }
  messages.push({ priority: "info", title: "How to interpret this report", details: `${WATERMARK_NOTE}\n${BUILD_NOTE}` });
  return messages;
}

export const coreMigrationStatusPlugin: SystemStatusPlugin = {
  id: "database.core-migrations",
  name: "Core Migrations",
  description: "Compares the recorded database migration version with core scripts registered in this running build.",
  scanMode: "immediate",
  needsReadOnlyDb: true,
  async scan() {
    return summary(await snapshot());
  },
  async details() {
    const state = await snapshot();
    return {
      groups: [
        {
          title: "Core migration status",
          rows: summary(state).map(message => ({
            label: message.title,
            description: message.details,
            priority: message.priority,
          })),
        },
        {
          title: "Five highest-numbered registered core scripts",
          rows: state.migrations.slice(0, 5).map(migration => ({
            label: `${migration.version}: ${migration.name}`,
            description: migration.description,
            value: state.version === null ? "Unknown — database version unavailable" :
              migration.version <= state.version ? "Covered by database version" : "Pending",
            priority: state.version === null || migration.version > state.version ? "warning" as const : "info" as const,
          })),
        },
      ],
    };
  },
};

registerSystemStatusPlugin(coreMigrationStatusPlugin);
