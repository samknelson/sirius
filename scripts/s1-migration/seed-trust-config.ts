/**
 * Seed trust_providers and trust_benefits FROM THE STAGED S1 NODES —
 * the "carry over as-is" ruling (06 §4.15, 2026-08-05: no consolidation at
 * migration time; the alias→canonical table is a later S2-phase input).
 *
 * This replaces the old hand-maintained benefit-name precondition. Deriving
 * from staging means the production run can never miss a benefit the dev
 * dataset didn't know about (Carelon EAP vs Behavioral Health are two
 * distinct benefits per the 2026-08-04 ruling; VSP and VSP Enhanced are two
 * live benefits of one carrier; Progyny, Hinge, Liberty, Kaiser E, Life,
 * AD&D and the historical EHS / United Concordia / Placeholder plans all
 * carry over exactly as S1 defines them).
 *
 * Resolution order (idempotent, crash-safe):
 *   benefits:  id_map("benefit") → trust_benefits.sirius_id == String(nid)
 *              → unique case-insensitive name adopt → CREATE (siriusId=nid)
 *   providers: id_map("provider") → data.s1Nid provenance → unique name adopt
 *              → CREATE (data.s1Nid=nid)
 * Benefit↔provider links are intentionally NOT created — S1 has no
 * provider↔benefit relation (EDI scoping is by benefit sirius_id).
 *
 * Run AFTER stage.ts and BEFORE load-elections / load-benefit-history.
 *
 * Usage: npx tsx scripts/s1-migration/seed-trust-config.ts [--dry-run]
 */
import { pool } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { resolveDatabaseUrl, describeDatabaseTarget } from "../../shared/database-url";
import { loadStaged } from "./lib/loader-utils";
import { getMappings, putMapping, ensureIdMap } from "./lib/idmap";
import { recordRun } from "./lib/staging";

const LOADER = "seed-trust-config";
const DRY_RUN = process.argv.includes("--dry-run");

interface SideReport {
  staged: number;
  viaIdMap: number;
  viaSiriusId: number;
  viaProvenance: number;
  viaName: number;
  created: number;
  createdNames: string[];
  titleMissingNids: number[];
}

function emptySide(): SideReport {
  return { staged: 0, viaIdMap: 0, viaSiriusId: 0, viaProvenance: 0, viaName: 0, created: 0, createdNames: [], titleMissingNids: [] };
}

async function seedProviders(): Promise<SideReport> {
  const r = emptySide();
  const staged = await loadStaged("sirius_trust_provider");
  r.staged = staged.length;
  const existingMap = await getMappings("provider", staged.map((s) => s.nid));
  const all = (await storage.trustProviders.getAllTrustProviders()) as Array<{
    id: string;
    name: string | null;
    data: Record<string, unknown> | null;
  }>;
  const byS1Nid = new Map<number, string>();
  const byName = new Map<string, string[]>();
  for (const p of all) {
    const nid = p.data && typeof p.data === "object" ? (p.data as Record<string, unknown>).s1Nid : undefined;
    if (typeof nid === "number") byS1Nid.set(nid, p.id);
    const k = (p.name ?? "").trim().toLowerCase();
    if (k) byName.set(k, [...(byName.get(k) ?? []), p.id]);
  }
  for (const s of staged) {
    if (existingMap.get(s.nid)) { r.viaIdMap++; continue; }
    const title = (s.title ?? "").trim();
    if (!title) { r.titleMissingNids.push(s.nid); continue; }
    const viaProv = byS1Nid.get(s.nid);
    if (viaProv) {
      r.viaProvenance++;
      if (!DRY_RUN) await putMapping("provider", s.nid, viaProv, { stub: false, loader: LOADER });
      continue;
    }
    const byN = byName.get(title.toLowerCase()) ?? [];
    if (byN.length === 1) {
      r.viaName++;
      if (!DRY_RUN) await putMapping("provider", s.nid, byN[0], { stub: false, loader: LOADER });
      continue;
    }
    r.created++;
    r.createdNames.push(title);
    if (!DRY_RUN) {
      const row = await storage.trustProviders.createTrustProvider({
        name: title,
        data: { source: "s1-migration", s1Nid: s.nid },
      });
      await putMapping("provider", s.nid, row.id, { stub: false, loader: LOADER });
    }
  }
  return r;
}

async function seedBenefits(): Promise<SideReport> {
  const r = emptySide();
  const staged = await loadStaged("sirius_trust_benefit");
  r.staged = staged.length;
  const existingMap = await getMappings("benefit", staged.map((s) => s.nid));
  const all = (await storage.trustBenefits.getAllTrustBenefits()) as Array<{
    id: string;
    name: string | null;
    siriusId: string | null;
  }>;
  const bySiriusId = new Map<string, string>();
  const byName = new Map<string, string[]>();
  for (const b of all) {
    if (b.siriusId != null && b.siriusId !== "") bySiriusId.set(String(b.siriusId), b.id);
    const k = (b.name ?? "").trim().toLowerCase();
    if (k) byName.set(k, [...(byName.get(k) ?? []), b.id]);
  }
  for (const s of staged) {
    if (existingMap.get(s.nid)) { r.viaIdMap++; continue; }
    const title = (s.title ?? "").trim();
    if (!title) { r.titleMissingNids.push(s.nid); continue; }
    const viaSid = bySiriusId.get(String(s.nid));
    if (viaSid) {
      r.viaSiriusId++;
      if (!DRY_RUN) await putMapping("benefit", s.nid, viaSid, { stub: false, loader: LOADER });
      continue;
    }
    const byN = byName.get(title.toLowerCase()) ?? [];
    if (byN.length === 1) {
      r.viaName++;
      if (!DRY_RUN) await putMapping("benefit", s.nid, byN[0], { stub: false, loader: LOADER });
      continue;
    }
    r.created++;
    r.createdNames.push(title);
    if (!DRY_RUN) {
      const row = await storage.trustBenefits.createTrustBenefit({
        siriusId: String(s.nid),
        name: title,
      });
      await putMapping("benefit", s.nid, row.id, { stub: false, loader: LOADER });
    }
  }
  return r;
}

async function main() {
  const startedAt = new Date();
  console.log(`[${LOADER}] target: ${describeDatabaseTarget(resolveDatabaseUrl())}${DRY_RUN ? " (DRY RUN)" : ""}`);

  // Single-run guard: read-then-create resolution is not concurrency-safe.
  // Session-scoped advisory lock (same key as bootstrap-target); released on exit.
  const lockClient = await pool.connect();
  const [{ got }] = (await lockClient.query(`SELECT pg_try_advisory_lock(727001) AS got`)).rows;
  if (!got) {
    console.error("FAIL: another migration process holds the advisory lock on this target.");
    process.exit(1);
  }

  await ensureIdMap();

  const { providers, benefits } = await withNotificationsSuppressed(async () => {
    const providers = await seedProviders();
    const benefits = await seedBenefits();
    return { providers, benefits };
  });

  const report = { loader: LOADER, dryRun: DRY_RUN, providers, benefits };
  console.log(JSON.stringify(report, null, 2));

  if (!DRY_RUN) {
    try {
      await recordRun(startedAt, { loader: LOADER, argv: process.argv.slice(2) }, report);
    } catch (e) {
      console.error("recordRun failed (non-fatal):", (e as Error).message?.split("\n")[0]);
    }
  }

  const missing = providers.titleMissingNids.length + benefits.titleMissingNids.length;
  if (missing > 0) {
    console.error(`FAIL: ${missing} staged node(s) have no title — cannot carry over. nids: ${[...providers.titleMissingNids, ...benefits.titleMissingNids].join(",")}`);
    lockClient.release();
    await pool.end();
    process.exit(1);
  }
  lockClient.release();
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  const dbg = process.env.S1_MIGRATION_DEBUG === "1";
  console.error(dbg ? e : `FATAL ${(e as Error).name}: ${String((e as Error).message ?? e).split("\n")[0]}`);
  process.exit(1);
});
