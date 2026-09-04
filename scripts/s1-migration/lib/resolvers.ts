/**
 * Shared resolution helpers for the T16–T19 loaders (elections, benefit
 * history, ledger charges, payments).
 *
 * Read-mostly and id_map-centric. The only writes are id_map rows recording
 * benefit / ledger-account adoptions and ledger_accounts CREATEs (T18a
 * adopt-or-create), all through the S2 storage layer.
 */
import { storage } from "../../../server/storage/database";
import { MIGRATION_SYSTEM_TIME_ZONE } from "./timezone-pin";
import { getMappings, putMapping } from "./idmap";
import { loadStaged, type StagedNode } from "./loader-utils";

// ---------------------------------------------------------------------------
// Multi-value entityreference extraction (delta order preserved)
// ---------------------------------------------------------------------------

/** Multi-value entityreference → ordered target nids (delta order kept,
 * duplicates collapsed keeping the first occurrence). */
export function targetNidsOf(fields: Record<string, unknown>, key: string): number[] {
  const raw = fields[key];
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const v of list) {
    let cand: unknown = v;
    if (cand && typeof cand === "object") {
      const o = cand as Record<string, unknown>;
      cand = o.target_id ?? o.value ?? o.tid;
    }
    const n =
      typeof cand === "number" ? cand : typeof cand === "string" && /^\d+$/.test(cand) ? Number(cand) : null;
    if (n != null && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Month math (T17 span→month expansion) and LA calendar helpers
// ---------------------------------------------------------------------------

export interface Ym {
  y: number;
  m: number; // 1-12
}

export function ymOfYmd(ymd: string): Ym {
  return { y: Number(ymd.slice(0, 4)), m: Number(ymd.slice(5, 7)) };
}

export function ymKey(ym: Ym): string {
  return `${ym.y}-${String(ym.m).padStart(2, "0")}`;
}

/** "YYYY-MM" → Ym, or null when malformed (CLI parsing). */
export function parseYm(s: string): Ym | null {
  const m = s.trim().match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const ym = { y: Number(m[1]), m: Number(m[2]) };
  return ym.m >= 1 && ym.m <= 12 ? ym : null;
}

export function compareYm(a: Ym, b: Ym): number {
  return a.y !== b.y ? a.y - b.y : a.m - b.m;
}

/** Safety valve for span expansion: a span longer than this many months is
 * almost certainly a bad date (e.g. year 9999) — reject, never expand. */
export const MAX_SPAN_MONTHS = 1200;

/** Inclusive month range a..b (caller guarantees a <= b). Throws past
 * MAX_SPAN_MONTHS — callers convert that to a span_too_long reject. */
export function monthsBetweenInclusive(a: Ym, b: Ym): Ym[] {
  const out: Ym[] = [];
  let y = a.y;
  let m = a.m;
  while (y < b.y || (y === b.y && m <= b.m)) {
    out.push({ y, m });
    if (out.length > MAX_SPAN_MONTHS) throw new Error(`span exceeds ${MAX_SPAN_MONTHS} months`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

// Fund-calendar bucketing is done in the PINNED system zone explicitly (never
// the host zone, even though the gate proves they are equal) — see
// lib/timezone-contract.ts. The user-zone framework plays no part here.
const LA_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: MIGRATION_SYSTEM_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Epoch seconds → LA-calendar "YYYY-MM-DD". Month boundaries are fund-local
 * (America/Los_Angeles), NOT UTC — a 2025-01-31 23:30 LA charge belongs to
 * January even though it is February in UTC. */
export function epochToLaYmd(epochSec: number): string {
  return LA_YMD.format(new Date(epochSec * 1000)); // en-CA gives YYYY-MM-DD
}

export function epochToLaYm(epochSec: number): Ym {
  return ymOfYmd(epochToLaYmd(epochSec));
}

/** Epoch seconds → first-of-month statement date in LA time ("YYYY-MM-01"). */
export function laStatementYmd(epochSec: number): string {
  return `${epochToLaYmd(epochSec).slice(0, 7)}-01`;
}

// ---------------------------------------------------------------------------
// T16/T17 benefit resolution: S1 sirius_trust_benefit nid → trust_benefits.id
// ---------------------------------------------------------------------------

export interface BenefitResolution {
  map: Map<number, string>;
  stagedBenefits: number;
  viaIdMap: number;
  viaSiriusId: number;
  viaName: number;
  ambiguousNames: number;
  unresolved: number[];
}

/**
 * Resolve staged S1 benefit nodes against the S2 trust_benefits fund config
 * (which is hand-adopted, NOT migrated — 06 §4.19). Resolution order:
 *   1. existing id_map rows (entity `benefit`)
 *   2. trust_benefits.sirius_id === String(nid)
 *   3. unique case-insensitive name match (staged title vs benefit name)
 * Successful 2/3 resolutions are recorded into id_map so later loaders (T18
 * references) see them. Unresolved nids stay out of the map — downstream
 * rows referencing them reject (benefit_unmapped), never guess.
 */
export async function resolveBenefitNidMap(loader: string, dryRun: boolean): Promise<BenefitResolution> {
  const staged = await loadStaged("sirius_trust_benefit");
  const res: BenefitResolution = {
    map: new Map(),
    stagedBenefits: staged.length,
    viaIdMap: 0,
    viaSiriusId: 0,
    viaName: 0,
    ambiguousNames: 0,
    unresolved: [],
  };
  const existing = await getMappings(
    "benefit",
    staged.map((s) => s.nid),
  );
  const all = (await storage.trustBenefits.getAllTrustBenefits()) as Array<{
    id: string;
    name: string | null;
    siriusId: string | null;
  }>;
  const bySiriusId = new Map<string, string>();
  for (const b of all) if (b.siriusId != null && b.siriusId !== "") bySiriusId.set(String(b.siriusId), b.id);
  const byName = new Map<string, string[]>();
  for (const b of all) {
    const k = (b.name ?? "").trim().toLowerCase();
    if (!k) continue;
    byName.set(k, [...(byName.get(k) ?? []), b.id]);
  }

  for (const s of staged) {
    const mapped = existing.get(s.nid);
    if (mapped) {
      res.map.set(s.nid, mapped.s2Id);
      res.viaIdMap++;
      continue;
    }
    const viaSid = bySiriusId.get(String(s.nid));
    if (viaSid) {
      res.map.set(s.nid, viaSid);
      res.viaSiriusId++;
      if (!dryRun) await putMapping("benefit", s.nid, viaSid, { stub: false, loader });
      continue;
    }
    const nameKey = (s.title ?? "").trim().toLowerCase();
    const byN = nameKey ? byName.get(nameKey) ?? [] : [];
    if (byN.length === 1) {
      res.map.set(s.nid, byN[0]);
      res.viaName++;
      if (!dryRun) await putMapping("benefit", s.nid, byN[0], { stub: false, loader });
      continue;
    }
    if (byN.length > 1) res.ambiguousNames++;
    res.unresolved.push(s.nid);
  }
  return res;
}

// ---------------------------------------------------------------------------
// T18/T19 financial-entity resolution (ledger participants, payment payers)
// ---------------------------------------------------------------------------

export interface ResolvedEntity {
  entityType: "worker" | "contact" | "employer";
  entityId: string;
  via: "worker" | "shell-worker" | "contact" | "employer";
}

/**
 * Build a nid → ledger-entity resolver over the id_map. Priority:
 *   worker → shell-worker (relationship alt-contact shells, keyed by the
 *   CONTACT nid, resolve as workers) → contact → employer.
 * Contact-typed EAs are legal but unusual — callers count them for review.
 */
export async function buildEntityResolver(
  nids: Iterable<number>,
): Promise<(nid: number) => ResolvedEntity | null> {
  const ids = [...new Set(nids)];
  const [workers, shells, contacts, employers] = await Promise.all([
    getMappings("worker", ids),
    getMappings("shell-worker", ids),
    getMappings("contact", ids),
    getMappings("employer", ids),
  ]);
  return (nid) => {
    const w = workers.get(nid);
    if (w) return { entityType: "worker", entityId: w.s2Id, via: "worker" };
    const sw = shells.get(nid);
    if (sw) return { entityType: "worker", entityId: sw.s2Id, via: "shell-worker" };
    const c = contacts.get(nid);
    if (c) return { entityType: "contact", entityId: c.s2Id, via: "contact" };
    const e = employers.get(nid);
    if (e) return { entityType: "employer", entityId: e.s2Id, via: "employer" };
    return null;
  };
}

// ---------------------------------------------------------------------------
// T18a ledger accounts: adopt-by-name or create (fund may preconfigure)
// ---------------------------------------------------------------------------

export interface LedgerAccountEnsureResult {
  map: Map<number, string>;
  stagedAccounts: number;
  viaIdMap: number;
  adoptedByName: number;
  created: number;
  /** nid → reason for accounts that could not be ensured (fatal downstream). */
  failed: Map<number, "account_title_missing" | "account_name_ambiguous" | "account_map_broken">;
}

/**
 * Ensure every staged S1 ledger account (sirius_ledger_account node) has an
 * S2 ledger_accounts row: id_map first, then unique case-insensitive name
 * adoption, then CREATE with provenance in data. Broken id_map rows (mapped
 * S2 id no longer exists) fail loud — repair the map, never silently remap.
 */
export async function ensureLedgerAccounts(
  loader: string,
  dryRun: boolean,
): Promise<LedgerAccountEnsureResult> {
  const staged: StagedNode[] = await loadStaged("sirius_ledger_account");
  const res: LedgerAccountEnsureResult = {
    map: new Map(),
    stagedAccounts: staged.length,
    viaIdMap: 0,
    adoptedByName: 0,
    created: 0,
    failed: new Map(),
  };
  const existing = await getMappings(
    "ledger-account",
    staged.map((s) => s.nid),
  );
  const all = await storage.ledger.accounts.getAll();
  const byId = new Map(all.map((a) => [a.id, a]));
  const byName = new Map<string, string[]>();
  for (const a of all) {
    const k = a.name.trim().toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), a.id]);
  }

  for (const s of staged) {
    const mapped = existing.get(s.nid);
    if (mapped) {
      if (!byId.has(mapped.s2Id)) {
        res.failed.set(s.nid, "account_map_broken");
        continue;
      }
      res.map.set(s.nid, mapped.s2Id);
      res.viaIdMap++;
      continue;
    }
    const title = (s.title ?? "").trim();
    if (!title) {
      res.failed.set(s.nid, "account_title_missing");
      continue;
    }
    const matches = byName.get(title.toLowerCase()) ?? [];
    if (matches.length > 1) {
      res.failed.set(s.nid, "account_name_ambiguous");
      continue;
    }
    if (matches.length === 1) {
      res.map.set(s.nid, matches[0]);
      res.adoptedByName++;
      if (!dryRun) await putMapping("ledger-account", s.nid, matches[0], { stub: false, loader });
      continue;
    }
    if (dryRun) {
      res.map.set(s.nid, `dry:${s.nid}`);
      res.created++;
      continue;
    }
    const created = await storage.ledger.accounts.create({
      name: title,
      description: "Imported from S1 ledger accounts",
      data: { source: "s1-migration", s1Nid: s.nid },
    } as Parameters<typeof storage.ledger.accounts.create>[0]);
    res.map.set(s.nid, created.id);
    res.created++;
    await putMapping("ledger-account", s.nid, created.id, { stub: false, loader });
  }
  return res;
}
