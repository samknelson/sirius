import { defineConfig } from "drizzle-kit";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

/**
 * `scripts/db-push.ts` writes `.drizzle-runtime.json` (and a companion
 * `.drizzle-runtime-schema.ts`) before invoking drizzle-kit so we can hide
 * tables owned by disabled components from the diff. When the file is
 * present we point drizzle-kit at the trimmed schema; when it is absent
 * (the default for ad-hoc `npx drizzle-kit ...` invocations) we fall back
 * to the full `shared/schema.ts` and behave exactly as before. The
 * runtime files are gitignored and deleted by the wrapper's `finally`
 * block.
 */
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
    url: process.env.DATABASE_URL,
  },
});
