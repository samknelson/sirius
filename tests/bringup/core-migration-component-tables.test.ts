/**
 * The core-migration / component-table lint rule (`unguardedReferences`).
 *
 * This rule exists because of a boot failure that already happened: a core
 * migration altered `dispatches`, a table only present where the optional
 * dispatch component is enabled, and every deployment without it stopped
 * mid-migration and refused traffic.
 *
 * A lint rule that fails to fire is invisible — the migration merges green
 * and the next disabled-component deployment brings up half a database. The
 * first version of this rule passed a file that had *any* existence probe
 * anywhere, so a migration probing table A and altering component table B
 * looked guarded. These fixtures pin the difference between a check that
 * protects the first use and one that only looks like it does.
 *
 * Pure: string fixtures, no filesystem, no database.
 */
import { describe, expect, it } from "vitest";
import { unguardedReferences } from "../../scripts/dev/check-core-migration-component-tables";

const OWNED = new Map([
  ["dispatches", "dispatch"],
  ["edls_sheets", "edls"],
]);

function tablesFlagged(source: string): string[] {
  return unguardedReferences(source, OWNED).map((v) => v.table);
}

const GUARD_HELPER = `
async function tableExists(name: string): Promise<boolean> {
  const result = await db.execute(sql\`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = \${name}
    ) AS present
  \`);
  return result.rows[0]?.present === true;
}
`;

describe("unguardedReferences", () => {
  it("flags the unconditional ALTER that caused the outage", () => {
    const source = `
      async function up() {
        await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS is_primary boolean\`);
      }
    `;
    expect(tablesFlagged(source)).toEqual(["dispatches"]);
  });

  it("accepts a probe for the table that returns early before the first use", () => {
    const source = `
      ${GUARD_HELPER}
      async function up() {
        if (!(await tableExists("dispatches"))) {
          logger.info("dispatches table absent, skipping");
          return;
        }
        await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN IF NOT EXISTS is_primary boolean\`);
      }
    `;
    expect(tablesFlagged(source)).toEqual([]);
  });

  it("accepts the in-query probe shape, where the name is quoted inside the check", () => {
    const source = `
      async function up() {
        const check = await db.execute(sql\`
          SELECT EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='edls_sheets') AS has_edls
        \`);
        if (check.rows[0]?.has_edls !== true) {
          return;
        }
        await db.execute(sql\`ALTER TABLE edls_sheets ADD COLUMN job_group_id varchar\`);
      }
    `;
    expect(tablesFlagged(source)).toEqual([]);
  });

  it("flags a table altered unconditionally when the probe is for a DIFFERENT table", () => {
    const source = `
      ${GUARD_HELPER}
      async function up() {
        if (!(await tableExists("edls_sheets"))) {
          return;
        }
        await db.execute(sql\`ALTER TABLE edls_sheets ADD COLUMN note text\`);
        await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN is_primary boolean\`);
      }
    `;
    expect(tablesFlagged(source)).toEqual(["dispatches"]);
  });

  it("flags a check that comes after the statement it was meant to protect", () => {
    const source = `
      ${GUARD_HELPER}
      async function up() {
        await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN is_primary boolean\`);
        if (!(await tableExists("dispatches"))) {
          return;
        }
      }
    `;
    expect(tablesFlagged(source)).toEqual(["dispatches"]);
  });

  it("flags a probe whose result is never branched on", () => {
    const source = `
      ${GUARD_HELPER}
      async function up() {
        await tableExists("dispatches");
        await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN is_primary boolean\`);
      }
    `;
    expect(tablesFlagged(source)).toEqual(["dispatches"]);
  });

  it("flags DDL that shares a template with a catalog query", () => {
    // The probe and the ALTER are in ONE sql template. Excusing the whole
    // template because it mentions information_schema would excuse the ALTER.
    const source = `
      async function up() {
        await db.execute(sql\`
          SELECT EXISTS (SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name='some_other_table') AS present;
          ALTER TABLE dispatches ADD COLUMN is_primary boolean
        \`);
      }
    `;
    expect(tablesFlagged(source)).toEqual(["dispatches"]);
  });

  it("flags a prose mention dressed up as a guard: comment, stray probe, unrelated branch", () => {
    const source = `
      ${GUARD_HELPER}
      async function up() {
        // "dispatches" is only touched where the dispatch component is on
        logger.info("dispatches");
        if (process.env.SOMETHING) {
          logger.info("unrelated branch");
        }
        await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN is_primary boolean\`);
      }
    `;
    expect(tablesFlagged(source)).toEqual(["dispatches"]);
  });

  it("ignores a table that is only mentioned in prose, not executed against", () => {
    const source = `
      /** Drops the legacy crew-lead table that predates the dispatches rewrite. */
      const migration = {
        description: "Retire the pre-dispatches crew lead table",
        up: async () => {
          logger.info("dispatches is untouched here");
          await db.execute(sql\`DROP TABLE IF EXISTS legacy_crewleads\`);
        },
      };
    `;
    expect(tablesFlagged(source)).toEqual([]);
  });

  it("reports the owning component so the author knows where the table came from", () => {
    const source = `await db.execute(sql\`ALTER TABLE dispatches ADD COLUMN is_primary boolean\`);`;
    expect(unguardedReferences(source, OWNED)).toEqual([
      expect.objectContaining({ table: "dispatches", componentId: "dispatch" }),
    ]);
  });
});
