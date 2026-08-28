/**
 * Task 415 — S1 options loader threshold reconciliation (DB-backed).
 *
 * Runs the REAL T4 options loader (scripts/s1-migration/load-options.ts) as a
 * subprocess against synthetic staged terms and pins the restored-threshold
 * behavior across every reconciliation path:
 *   - create: a new staged 60-hour member status lands with
 *     data.sitespecific.bao.threshold = 60,
 *   - name adoption: a pre-seeded S2 row adopted by name gets the decoded
 *     threshold merged WITHOUT erasing its S2-only JSON,
 *   - logic-version reprocessing: an already-mapped row stamped at logic
 *     version 1 (the pre-fix state: fingerprint current, data missing the
 *     threshold) is reprocessed by v2 and repaired, siblings preserved,
 *   - missing source value: a term with no "- NN hours" suffix is reported
 *     explicitly and its S2 data is never touched (S2-only thresholds
 *     survive reruns),
 *   - repeat-run stability: a second run fast-path-skips everything and
 *     changes nothing.
 *
 * Uses unique far-range tids and run-prefixed names; cleans staging, id_map,
 * and created options rows afterwards.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../../server/db";
import { getOptionsStorage } from "../../server/modules/options-registry";
import { ensureStagingSchema } from "../../scripts/s1-migration/lib/staging";
import { ensureIdMap } from "../../scripts/s1-migration/lib/idmap";

const execFileAsync = promisify(execFile);
const run = `t4-thresh-${Date.now()}`;

// Synthetic tids far outside any real S1 range.
const TID_INDUSTRY = 98_990_001;
const TID_CREATE = 98_990_002; // "- 60 hours" → created with threshold
const TID_ADOPT = 98_990_003; // "- 40 Hours" → adopted by name, merged
const TID_MAPPED_V1 = 98_990_004; // mapped at logic v1 → reprocessed by v2
const TID_NO_SUFFIX = 98_990_005; // "PA Worker" style → reported, untouched
const ALL_TIDS = [TID_INDUSTRY, TID_CREATE, TID_ADOPT, TID_MAPPED_V1, TID_NO_SUFFIX];

const NAME_INDUSTRY = `${run} industry`;
const NAME_CREATE = `${run} Worker - 60 hours`;
const NAME_ADOPT = `${run} Adopted Worker - 40 Hours`;
const NAME_MAPPED = `${run} Mapped Worker - 80 hours`;
const NAME_NO_SUFFIX = `${run} PA Worker`;

let adoptRowId = "";
let mappedRowId = "";
let industryRowId = "";
const cleanupMsIds: string[] = [];

async function stageTerm(
  tid: number,
  vocabulary: string,
  name: string,
  fields: Record<string, unknown>,
  contentHash: string,
) {
  await db.execute(sql`
    INSERT INTO s1_staging.terms (tid, vocabulary, name, description, weight, fields, content_hash)
    VALUES (${tid}, ${vocabulary}, ${name}, NULL, 0, ${JSON.stringify(fields)}::jsonb, ${contentHash})
    ON CONFLICT (tid) DO UPDATE SET vocabulary = EXCLUDED.vocabulary, name = EXCLUDED.name,
      fields = EXCLUDED.fields, content_hash = EXCLUDED.content_hash
  `);
}

async function runLoader(...extraArgs: string[]) {
  // Stale mappings from earlier (crashed) test runs can surface as
  // report-only deleted_in_s1 findings; acknowledge them so this test only
  // fails on ITS OWN scenarios.
  const { stdout, stderr } = await execFileAsync(
    "npx",
    ["tsx", "scripts/s1-migration/load-options.ts", "--allow-findings", "deleted_in_s1", ...extraArgs],
    { cwd: process.cwd(), timeout: 240_000, maxBuffer: 32 * 1024 * 1024, env: process.env },
  ).catch((err) => {
    throw new Error(`loader failed (exit ${err.code}):\n${err.stdout}\n${err.stderr}`);
  });
  return stdout + "\n" + stderr;
}

async function msRowByName(name: string): Promise<any | undefined> {
  const rows: any[] = await getOptionsStorage().list("worker-ms");
  return rows.find((r) => r.name === name);
}

function thresholdOf(row: any): unknown {
  return row?.data?.sitespecific?.bao?.threshold;
}

beforeAll(async () => {
  await ensureStagingSchema();
  await ensureIdMap();
  const options = getOptionsStorage();

  // Fixture industry + staged terms. The industry term must be staged too so
  // worker-ms terms resolve their field_sirius_industry through this run.
  await stageTerm(TID_INDUSTRY, "sirius_industry", NAME_INDUSTRY, {}, "h-ind-1");
  const msFields = { field_sirius_industry: TID_INDUSTRY };
  await stageTerm(TID_CREATE, "sirius_member_status", NAME_CREATE, msFields, "h-create-1");
  await stageTerm(TID_ADOPT, "sirius_member_status", NAME_ADOPT, msFields, "h-adopt-1");
  await stageTerm(TID_MAPPED_V1, "sirius_member_status", NAME_MAPPED, msFields, "h-mapped-1");
  await stageTerm(TID_NO_SUFFIX, "sirius_member_status", NAME_NO_SUFFIX, msFields, "h-nosuffix-1");

  // Pre-seed the S2 side. Both pre-existing rows need a real industry; the
  // loader will re-point industryId to ITS industry row, which is fine.
  industryRowId = (await options.create("industry", { name: `${run} preseed industry` })).id;

  // Adoption target: same name, S2-only JSON that must survive the merge.
  adoptRowId = (
    await options.create("worker-ms", {
      name: NAME_ADOPT,
      industryId: industryRowId,
      data: { s2Only: "keep-adopt" },
    })
  ).id;

  // Already-mapped row in the PRE-FIX state: mapped by v1 with a current
  // fingerprint but NO threshold in data (v1 never wrote one).
  mappedRowId = (
    await options.create("worker-ms", {
      name: NAME_MAPPED,
      industryId: industryRowId,
      siriusId: String(TID_MAPPED_V1),
      data: { s2Only: "keep-mapped" },
    })
  ).id;
  await db.execute(sql`
    INSERT INTO s1_staging.id_map (entity, s1_id, s2_id, stub, loader, consumed_fingerprint, logic_version)
    VALUES ('term', ${TID_MAPPED_V1}, ${mappedRowId}, false, 't4-options', 'h-mapped-1', 1)
    ON CONFLICT (entity, s1_id) DO UPDATE SET s2_id = EXCLUDED.s2_id,
      consumed_fingerprint = EXCLUDED.consumed_fingerprint, logic_version = EXCLUDED.logic_version
  `);
}, 180_000);

afterAll(async () => {
  const options = getOptionsStorage();
  await db.execute(sql`DELETE FROM s1_staging.terms WHERE tid = ANY(ARRAY[${sql.join(ALL_TIDS.map((t) => sql`${t}`), sql`, `)}]::bigint[])`);
  await db.execute(sql`DELETE FROM s1_staging.id_map WHERE entity = 'term' AND s1_id = ANY(ARRAY[${sql.join(ALL_TIDS.map((t) => sql`${t}`), sql`, `)}]::bigint[])`);
  const rows: any[] = await options.list("worker-ms");
  for (const r of rows) {
    if (typeof r.name === "string" && r.name.startsWith(run)) {
      await options.delete("worker-ms", r.id).catch(() => {});
    }
  }
  const industries: any[] = await options.list("industry");
  for (const r of industries) {
    if (typeof r.name === "string" && r.name.startsWith(run)) {
      await options.delete("industry", r.id).catch(() => {});
    }
  }
}, 180_000);

describe("T4 options loader — worker-ms threshold reconciliation", () => {
  it("restores thresholds across create / adopt / logic-version paths and reports missing source values", async () => {
    const out = await runLoader();

    // create: new 60-hour status carries the canonical nested threshold.
    const created = await msRowByName(NAME_CREATE);
    expect(created, "created 60-hour status").toBeTruthy();
    expect(thresholdOf(created)).toBe(60);
    expect(created.siriusId).toBe(String(TID_CREATE));

    // adopt: decoded 40 merged in, S2-only sibling preserved.
    const adopted = await msRowByName(NAME_ADOPT);
    expect(adopted.id).toBe(adoptRowId);
    expect(thresholdOf(adopted)).toBe(40);
    expect(adopted.data.s2Only).toBe("keep-adopt");

    // logic-version reprocess: v1 mapping with current fingerprint is NOT
    // fast-skipped by v2; the missing threshold is repaired, siblings kept.
    const mapped = await msRowByName(NAME_MAPPED);
    expect(mapped.id).toBe(mappedRowId);
    expect(thresholdOf(mapped)).toBe(80);
    expect(mapped.data.s2Only).toBe("keep-mapped");

    // missing source value: reported explicitly, data untouched.
    const noSuffix = await msRowByName(NAME_NO_SUFFIX);
    expect(noSuffix, "no-suffix status still created").toBeTruthy();
    expect(thresholdOf(noSuffix)).toBeUndefined();
    expect(out).toContain(`tid ${TID_NO_SUFFIX}`);
    expect(out).toContain("workerMsThresholdMissing");
  });

  it("is idempotent: a rerun fast-skips unchanged terms and changes nothing", async () => {
    const before = await Promise.all(
      [NAME_CREATE, NAME_ADOPT, NAME_MAPPED, NAME_NO_SUFFIX].map(msRowByName),
    );
    await runLoader();
    const after = await Promise.all(
      [NAME_CREATE, NAME_ADOPT, NAME_MAPPED, NAME_NO_SUFFIX].map(msRowByName),
    );
    for (let i = 0; i < before.length; i++) {
      expect(after[i].data).toEqual(before[i].data);
      expect(after[i].id).toBe(before[i].id);
    }
  });

  it("preserves a legitimate S2-only threshold when the source name has no suffix (force-reconcile)", async () => {
    // Operators may configure a threshold directly in S2 for a status whose
    // S1 name never carried one — the loader must never erase it.
    const options = getOptionsStorage();
    const noSuffix = await msRowByName(NAME_NO_SUFFIX);
    await options.update("worker-ms", noSuffix.id, {
      data: { ...(noSuffix.data ?? {}), sitespecific: { bao: { threshold: 1 } } },
    });
    await runLoader("--force-reconcile");
    const after = await msRowByName(NAME_NO_SUFFIX);
    expect(thresholdOf(after)).toBe(1);
  });
});
