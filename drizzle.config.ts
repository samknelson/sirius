import { defineConfig } from "drizzle-kit";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// Same resolution rule as server/storage/db.ts: EXTERNAL_DATABASE_URL is
// authoritative everywhere so drizzle-kit can never diff/mutate a different
// database than the one the app runs against.
const databaseUrl = process.env.EXTERNAL_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "EXTERNAL_DATABASE_URL or DATABASE_URL must be set, ensure the database is provisioned",
  );
}

// Guardrail: show which database drizzle-kit will target (never credentials).
try {
  const u = new URL(databaseUrl);
  const source = process.env.EXTERNAL_DATABASE_URL ? "EXTERNAL_DATABASE_URL" : "DATABASE_URL";
  console.log(`[drizzle] Target database: ${u.hostname}${u.pathname} (from ${source})`);
} catch {
  console.log("[drizzle] Target database: <unparseable connection string>");
}

// `scripts/db-push.ts` writes `.drizzle-runtime.json` (and a companion
// `.drizzle-runtime-schema.ts`) before invoking drizzle-kit so we can hide
// tables owned by disabled components from the diff. When the file is absent
// (the default for ad-hoc `npx drizzle-kit ...` calls) we use the full
// `shared/schema.ts` and behave exactly as before.
function loadSchemaPath(): string {
  const runtimeFile = resolve(process.cwd(), ".drizzle-runtime.json");
  if (existsSync(runtimeFile)) {
    try {
      const parsed = JSON.parse(readFileSync(runtimeFile, "utf8"));
      if (typeof parsed?.schemaPath === "string") {
        return parsed.schemaPath;
      }
    } catch {
      // ignore — fall back to default
    }
  }
  return "./shared/schema.ts";
}

export default defineConfig({
  out: "./migrations",
  schema: loadSchemaPath(),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
