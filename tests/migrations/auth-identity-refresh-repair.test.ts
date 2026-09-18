import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "scripts/migrate/core/1197_repair_auth_identity_timestamps.ts",
  "utf8",
);

describe("refreshed auth identity timestamp repair", () => {
  it("repairs missing columns and malformed defaults/nullability idempotently", () => {
    for (const column of ["created_at", "updated_at"]) {
      expect(source).toContain(`ADD COLUMN IF NOT EXISTS ${column} timestamp`);
      expect(source).toContain(`ALTER COLUMN ${column} SET DEFAULT now()`);
      expect(source).toContain(`ALTER COLUMN ${column} DROP NOT NULL`);
    }
    expect(source).toContain("to_regclass('public.auth_identities')");
  });

  it("preserves every existing identity timestamp", () => {
    expect(source).not.toMatch(/\bUPDATE\s+auth_identities\b/i);
    expect(source).not.toMatch(/\bDROP\s+COLUMN\b/i);
  });
});