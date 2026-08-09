/**
 * S1 → S2 migration: employer policy history (backfill for "Unknown policy").
 *
 * S2 derives an election's policy from the EMPLOYER (resolveEmployerPolicyAsOf:
 * employer_policy_history → employers.denorm_policy_id → policy_default) —
 * elections store policy_id=NULL by design. Nothing in the earlier waves
 * populates employer policy history, so every migrated election renders
 * "Unknown policy" until this loader runs.
 *
 * S1 source (confirmed on prod MariaDB 2026-08-09): the shop node's
 * field_sirius_json blob carries the Policy tab's data —
 *   { "ledger": { "policy": {
 *       "ebh": [ { "policy": "<S1 policy nid>", "date": "YYYY-MM-DD" }, ... ],
 *       "nid": "<current S1 policy nid>" } } }
 * `ebh` is the effective-by-history table shown in the S1 employer UI
 * ("Policy" / "Effective From"); `nid` is the currently-effective policy.
 * The shop bundle has NO policy entity-reference field
 * (field_data_field_sirius_trust_policy is elections-only, verified by bundle
 * census), and prod shows 248 shops carrying ledger.policy JSON.
 *
 * What this loader does per staged grievance_shop row:
 *   1. Parse field_sirius_json → ledger.policy (absent → counted, not a reject).
 *   2. Resolve shop nid → S2 employer (id_map "employer") and every ebh
 *      policy nid → S2 policy (id_map "policy", written by load-policies).
 *   3. Validate the WHOLE shop first (any bad entry rejects the whole shop —
 *      never a partial history that would sync a wrong denorm_policy_id).
 *   4. Create employer_policy_history rows through storage (which auto-syncs
 *      employers.denorm_policy_id to the latest-dated row). Idempotent:
 *      existing (date, policyId) rows are adopted, not duplicated.
 *   5. Verify denorm_policy_id landed (and matches the S1 current nid when
 *      one is present).
 *
 * Ordering: AFTER load-employers (employer id_map) and load-policies (policy
 * id_map). Elections need no rerun — policy resolution is derived at read
 * time.
 *
 * Reject classes (ALL fatal for the shop — must be explicitly allowed per
 * run via --allow-rejects):
 *   bad_json                 — field_sirius_json present but unparseable
 *   shop_unmapped            — shop nid has no (non-stub) employer id_map row
 *   policy_unmapped          — an ebh policy nid has no (non-stub) policy id_map row
 *   bad_date                 — an ebh date is not a valid YYYY-MM-DD
 *   current_without_history  — ledger.policy.nid set but ebh empty (no
 *                              effective date exists to write — needs a ruling)
 *   current_mismatch         — ledger.policy.nid differs from the latest ebh
 *                              entry (S1 self-inconsistent — needs a ruling)
 *   history_create_failed    — storage write failed (sanitized code only)
 *
 * Output is AGGREGATES ONLY — safe inside the HIPAA boundary (nids are node
 * ids, consistent with the other loaders' reject samples).
 *
 * Usage:
 *   npx tsx scripts/s1-migration/load-employer-policies.ts [--dry-run] [--allow-rejects a,b]
 */
import { storage } from "../../server/storage/database";
import { withNotificationsSuppressed } from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import { ensureIdMap, getMappings } from "./lib/idmap";
import { RejectLog, loadStaged, toYmd } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";

const DRY_RUN = process.argv.includes("--dry-run");
const LOADER = "t-employer-policies";
const ALLOWED_REJECTS: string[] = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean) : [];
})();

interface EbhEntry {
  s1PolicyNid: number;
  date: string; // validated YYYY-MM-DD
}

function parseShopJson(fields: Record<string, unknown>): { json: unknown; present: boolean; parseError: boolean } {
  // Production stages field_sirius_json as an object ({value, ...}); tolerate
  // a scalar-staged shape too (same tolerance as load-hours).
  const raw = fields["field_sirius_json"] as { value?: unknown } | string | undefined;
  let v: unknown = typeof raw === "object" && raw !== null && "value" in raw ? raw.value : raw;
  if (v == null) return { json: null, present: false, parseError: false };
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return { json: null, present: true, parseError: true };
    }
  }
  return { json: v, present: true, parseError: false };
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();

  const report: Record<string, unknown> = { loader: LOADER, dryRun: DRY_RUN, allowedRejects: ALLOWED_REJECTS };
  const rejects = new RejectLog();
  const progress = makeProgressLogger(LOADER, 0);
  progress.phase("pre-scan");

  const shops = await loadStaged("grievance_shop");
  report.shopsStaged = shops.length;

  // ── Pass 1: parse + collect every shop's policy block ────────────────────
  type ShopPolicy = {
    nid: number;
    entries: Array<{ s1PolicyNid: number; rawDate: unknown }>;
    currentS1Nid: number | null;
  };
  const withPolicy: ShopPolicy[] = [];
  let shopsWithJson = 0;
  let shopsWithoutPolicy = 0;

  for (const s of shops) {
    const { json, present, parseError } = parseShopJson(s.fields);
    if (!present) continue;
    shopsWithJson++;
    if (parseError) {
      rejects.add("bad_json", { nid: s.nid }, s.nid);
      continue;
    }
    const pol = (json as any)?.ledger?.policy;
    if (pol == null || typeof pol !== "object") {
      shopsWithoutPolicy++;
      continue;
    }
    const ebhRaw = Array.isArray((pol as any).ebh) ? ((pol as any).ebh as unknown[]) : [];
    const entries: Array<{ s1PolicyNid: number; rawDate: unknown }> = [];
    for (const e of ebhRaw) {
      const nidStr = String((e as any)?.policy ?? "").trim();
      const s1PolicyNid = /^\d+$/.test(nidStr) ? Number(nidStr) : NaN;
      entries.push({ s1PolicyNid, rawDate: (e as any)?.date });
    }
    const curStr = String((pol as any).nid ?? "").trim();
    const currentS1Nid = /^\d+$/.test(curStr) ? Number(curStr) : null;
    withPolicy.push({ nid: s.nid, entries, currentS1Nid });
  }
  report.shopsWithJson = shopsWithJson;
  report.shopsWithPolicy = withPolicy.length;
  report.shopsWithoutPolicy = shopsWithoutPolicy;

  // ── Batched id_map resolution ─────────────────────────────────────────────
  const employerMap = await getMappings("employer", withPolicy.map((s) => s.nid));
  const allPolicyNids = [
    ...new Set(
      withPolicy.flatMap((s) => [
        ...s.entries.map((e) => e.s1PolicyNid).filter((n) => Number.isFinite(n)),
        ...(s.currentS1Nid != null ? [s.currentS1Nid] : []),
      ]),
    ),
  ];
  const policyMap = await getMappings("policy", allPolicyNids);
  report.distinctS1PolicyNids = allPolicyNids.length;

  // ── Pass 2: validate whole-shop, then write ───────────────────────────────
  progress.phase(null);
  progress.setTotal(withPolicy.length);
  let created = 0;
  let adopted = 0;
  let employersTouched = 0;
  const okShops: Array<{ nid: number; employerId: string; expectedCurrentPolicyId: string | null }> = [];

  for (const shop of withPolicy) {
    progress.add(1);
    const emp = employerMap.get(shop.nid);
    if (!emp || emp.stub) {
      rejects.add("shop_unmapped", { nid: shop.nid, stub: emp?.stub ?? false }, shop.nid);
      continue;
    }

    // Validate every entry before writing anything for this shop.
    const valid: EbhEntry[] = [];
    let shopRejected = false;
    for (const e of shop.entries) {
      if (!Number.isFinite(e.s1PolicyNid) || !policyMap.get(e.s1PolicyNid) || policyMap.get(e.s1PolicyNid)!.stub) {
        rejects.add("policy_unmapped", { nid: shop.nid, s1PolicyNid: e.s1PolicyNid }, shop.nid);
        shopRejected = true;
        continue;
      }
      const ymd = typeof e.rawDate === "string" ? toYmd(e.rawDate) : null;
      if (!ymd) {
        rejects.add("bad_date", { nid: shop.nid, s1PolicyNid: e.s1PolicyNid }, shop.nid);
        shopRejected = true;
        continue;
      }
      valid.push({ s1PolicyNid: e.s1PolicyNid, date: ymd });
    }

    // Current-policy consistency: the S1 UI derives "current" from the same
    // history, so a mismatch means S1 is self-inconsistent — rule, don't guess.
    if (!shopRejected && shop.currentS1Nid != null) {
      if (valid.length === 0) {
        rejects.add("current_without_history", { nid: shop.nid, s1PolicyNid: shop.currentS1Nid }, shop.nid);
        shopRejected = true;
      } else {
        const latest = valid.reduce((a, b) => (b.date >= a.date ? b : a));
        if (latest.s1PolicyNid !== shop.currentS1Nid) {
          rejects.add(
            "current_mismatch",
            { nid: shop.nid, currentS1Nid: shop.currentS1Nid, latestEbhNid: latest.s1PolicyNid },
            shop.nid,
          );
          shopRejected = true;
        }
      }
    }
    if (shopRejected || valid.length === 0) continue;

    // Dedupe identical (date, policy) pairs within the S1 blob itself.
    const seen = new Set<string>();
    const entries = valid.filter((e) => {
      const k = `${e.date}|${e.s1PolicyNid}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const expectedCurrent = entries.reduce((a, b) => (b.date >= a.date ? b : a));
    const expectedCurrentPolicyId = policyMap.get(expectedCurrent.s1PolicyNid)!.s2Id;

    if (DRY_RUN) {
      created += entries.length;
      okShops.push({ nid: shop.nid, employerId: emp.s2Id, expectedCurrentPolicyId });
      continue;
    }

    try {
      const existing = await storage.employerPolicyHistory.getEmployerPolicyHistory(emp.s2Id);
      const existingKeys = new Set(existing.map((r: any) => `${r.date}|${r.policyId}`));
      let wrote = false;
      for (const e of entries) {
        const policyId = policyMap.get(e.s1PolicyNid)!.s2Id;
        if (existingKeys.has(`${e.date}|${policyId}`)) {
          adopted++;
          continue;
        }
        await withNotificationsSuppressed(() =>
          storage.employerPolicyHistory.createEmployerPolicyHistory({
            employerId: emp.s2Id,
            date: e.date,
            policyId,
            data: { source: "s1-migration", s1ShopNid: shop.nid, s1PolicyNid: e.s1PolicyNid },
          }),
        );
        created++;
        wrote = true;
      }
      if (wrote) employersTouched++;
      okShops.push({ nid: shop.nid, employerId: emp.s2Id, expectedCurrentPolicyId });
    } catch (err) {
      // Sanitized: class/code only — never raw error text (HIPAA boundary).
      const code = err instanceof Error ? err.constructor.name : "unknown";
      rejects.add("history_create_failed", { nid: shop.nid, code }, shop.nid);
    }
  }

  report.historyCreated = created;
  report.historyAdopted = adopted;
  report.employersTouched = employersTouched;

  // ── Verify: denorm_policy_id synced for every ok shop ─────────────────────
  let verifyFailures = 0;
  if (!DRY_RUN) {
    progress.phase("verify", okShops.length);
    for (const ok of okShops) {
      progress.add(1);
      const emp = await storage.employers.getEmployer(ok.employerId);
      if (!emp) {
        console.error(`VERIFY: shop nid ${ok.nid} maps to missing employer ${ok.employerId}`);
        verifyFailures++;
        continue;
      }
      const denorm = (emp as any).denormPolicyId ?? null;
      if (denorm == null) {
        console.error(`VERIFY: shop nid ${ok.nid} employer has no denorm_policy_id after load`);
        verifyFailures++;
        continue;
      }
      // Only assert equality when this loader's rows are the whole history —
      // pre-existing S2 rows with later dates may legitimately win the sync.
      if (ok.expectedCurrentPolicyId != null && denorm !== ok.expectedCurrentPolicyId) {
        const history = await storage.employerPolicyHistory.getEmployerPolicyHistory(ok.employerId);
        const foreign = history.some((r: any) => (r.data as any)?.source !== "s1-migration");
        if (!foreign) {
          console.error(`VERIFY: shop nid ${ok.nid} denorm_policy_id != latest S1 ebh policy`);
          verifyFailures++;
        }
      }
    }
  }

  progress.stop();
  report.rejects = rejects.counts;
  report.rejectSamples = rejects.samples;
  report.verifyFailures = verifyFailures;

  console.log(JSON.stringify(report, null, 2));
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER }, report);

  const disallowed = rejects.disallowedReasons(ALLOWED_REJECTS);
  if (disallowed.length > 0) {
    console.error(
      `FAIL: reject reason(s) not allowed for this run: ${disallowed.map((d) => `${d.reason}=${d.count}`).join(", ")}. ` +
        `Every expected reject class must be explicitly allowed via --allow-rejects.`,
    );
    process.exit(1);
  }
  process.exit(verifyFailures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
