import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getClient } from "../../../server/storage/transaction-context";
import { canonicalJson } from "./sync";
import { financialReferenceNids, loadFinancialSourceIndex, resolveFinancialPage, rowsOf } from "./financial-identity";
import { sameFinancialCoordinate, type FinancialEntity } from "./financial-identity-plan";
import { toCents } from "./parity";

export interface FinancialRebind {
  stream: "ar" | "payment";
  id: string;
  oldEaId: string;
  accountId: string;
  entity: FinancialEntity;
}
export interface FinancialLinkInventory {
  evidenceHash: string;
  checkpoint: string;
  counts: Record<string, number>;
  blocked: number;
  mismatched: number;
  rebinds: FinancialRebind[];
}
const inList = (values: Array<string | number>) => sql.join(values.map((v) => sql`${v}`), sql`, `);

/**
 * Read-only inventory: NO staging bootstrap, mapping adoption, run-report
 * insert or EA creation. Exact source/target evidence remains inside the
 * process; only the digest and aggregate counters may be printed.
 */
export async function inventoryFinancialLinks(
  checkpoint: string,
  options: { streams?: Array<"ar" | "payment">; retainRebinds?: boolean } = {},
): Promise<FinancialLinkInventory> {
  if (!checkpoint.trim()) throw new Error("A reviewed common source/staging checkpoint is required");
  const hash = createHash("sha256");
  const add = (v: unknown) => hash.update(canonicalJson(v) + "\n");
  add({ contract: "s1-contact-financial-identity-v1", checkpoint, streams: options.streams ?? ["ar", "payment"] });
  const source = await loadFinancialSourceIndex();
  add([...source.byWorker]);
  const result: FinancialLinkInventory = {
    checkpoint, evidenceHash: "", counts: {}, blocked: 0, mismatched: 0, rebinds: [],
  };
  const count = (key: string) => { result.counts[key] = (result.counts[key] ?? 0) + 1; };
  // Internal person/account attribution; only counts of coordinates and
  // mismatches leave the process, never person IDs or person-level amounts.
  const attribution = new Map<string, { expectedCount: number; actualCount: number; expectedCents: number; actualCents: number }>();
  const attribute = (key: string, side: "expected" | "actual", cents: number | null) => {
    const agg = attribution.get(key) ?? { expectedCount: 0, actualCount: 0, expectedCents: 0, actualCents: 0 };
    agg[`${side}Count`]++;
    agg[`${side}Cents`] += cents ?? 0;
    attribution.set(key, agg);
  };
  for (const stream of options.streams ?? ["ar", "payment"] as const) {
    let after = 0;
    for (;;) {
      const staged = stream === "ar"
        ? rowsOf<{ nid: string; participant: string | null; account: string | null; snapshot: unknown }>(await getClient().execute(sql`
            SELECT ledger_id AS nid, ledger_participant AS participant, ledger_account AS account, to_jsonb(r) AS snapshot
            FROM s1_staging.raw_ledger_ar r
            WHERE ledger_id > ${after} AND lower(trim(coalesce(ledger_status,''))) = 'cleared'
            ORDER BY ledger_id LIMIT 1000
          `))
        : rowsOf<{ nid: string; fields: Record<string, unknown>; snapshot: unknown }>(await getClient().execute(sql`
            SELECT nid, fields, to_jsonb(r) AS snapshot FROM s1_staging.records r
            WHERE bundle = 'sirius_payment' AND nid > ${after} ORDER BY nid LIMIT 1000
          `)).map((r) => {
            const payers = financialReferenceNids(r.fields.field_sirius_payer);
            const accounts = financialReferenceNids(r.fields.field_sirius_ledger_account);
            return { ...r, participant: payers.length === 1 ? String(payers[0]) : null,
              account: accounts.length === 1 ? String(accounts[0]) : null };
          });
      if (!staged.length) break;
      after = Number(staged[staged.length - 1].nid);
      const { decisions, evidence } = await resolveFinancialPage(
        staged.filter((r) => r.participant != null).map((r) => Number(r.participant)), source,
      );
      const accountNids = [...new Set(staged.filter((r) => r.account != null).map((r) => Number(r.account)))];
      const accounts = accountNids.length ? rowsOf<{ s1_id: string; s2_id: string; snapshot: unknown; target: unknown }>(await getClient().execute(sql`
        SELECT m.s1_id, m.s2_id, to_jsonb(m) AS snapshot, to_jsonb(a) AS target
        FROM s1_staging.id_map m LEFT JOIN ledger_accounts a ON a.id = m.s2_id
        WHERE m.entity = 'ledger-account' AND m.s1_deleted_at IS NULL AND m.s1_id IN (${inList(accountNids)})
        ORDER BY m.s1_id
      `)) : [];
      add(accounts);
      const expectedEntityIds = [...new Set([...decisions.values()].flatMap((d) => d.ok ? [d.entity.entityId] : []))];
      const expectedAccountIds = [...new Set(accounts.map((a) => a.s2_id))];
      if (expectedEntityIds.length && expectedAccountIds.length) {
        add(rowsOf(await getClient().execute(sql`
          SELECT to_jsonb(ea) AS canonical_ea FROM ledger_ea ea
          WHERE ea.entity_id IN (${inList(expectedEntityIds)})
            AND ea.account_id IN (${inList(expectedAccountIds)})
          ORDER BY ea.id
        `)));
      }
      type Target = { id: string; nid: string; eaId: string; entityType: string; entityId: string; accountId: string;
        snapshot: unknown; ea: unknown; mappedId: string | null; mapping: unknown; owned: boolean };
      const nids = staged.map((r) => Number(r.nid));
      const financialMappings = rowsOf<{ s1_id: string; s2_id: string; snapshot: unknown }>(await getClient().execute(sql`
        SELECT s1_id, s2_id, to_jsonb(m) AS snapshot FROM s1_staging.id_map m
        WHERE entity = ${stream === "ar" ? "ledger-ar" : "payment"} AND s1_id IN (${inList(nids)})
        ORDER BY s1_id
      `));
      add(financialMappings);
      const targets = stream === "ar"
        ? rowsOf<Target>(await getClient().execute(sql`
            SELECT l.id, substring(l.charge_plugin_key from 4) AS nid, l.ea_id AS "eaId",
              ea.entity_type AS "entityType", ea.entity_id AS "entityId", ea.account_id AS "accountId",
              to_jsonb(l) AS snapshot, to_jsonb(ea) AS ea, m.s2_id AS "mappedId", to_jsonb(m) AS mapping,
              (l.data->>'source' = 's1-migration' AND l.data->>'s1LedgerId' = substring(l.charge_plugin_key from 4)) AS owned
            FROM ledger l LEFT JOIN ledger_ea ea ON ea.id = l.ea_id
            LEFT JOIN s1_staging.id_map m ON m.entity = 'ledger-ar' AND m.s1_id::text = substring(l.charge_plugin_key from 4)
            WHERE l.charge_plugin = 's1-import' AND l.charge_plugin_key IN (${inList(nids.map((n) => `ar-${n}`))})
            ORDER BY l.id
          `))
        : rowsOf<Target>(await getClient().execute(sql`
            SELECT p.id, p.details->>'s1Nid' AS nid, p.ledger_ea_id AS "eaId",
              ea.entity_type AS "entityType", ea.entity_id AS "entityId", ea.account_id AS "accountId",
              to_jsonb(p) AS snapshot, to_jsonb(ea) AS ea, m.s2_id AS "mappedId", to_jsonb(m) AS mapping,
              (p.details->>'source' = 's1-migration' AND p.details->>'paymentAttemptId' IS NULL) AS owned
            FROM ledger_payments p LEFT JOIN ledger_ea ea ON ea.id = p.ledger_ea_id
            LEFT JOIN s1_staging.id_map m ON m.entity = 'payment' AND m.s1_id::text = p.details->>'s1Nid'
            WHERE p.details->>'source' = 's1-migration' AND p.details->>'s1Nid' IN (${inList(nids.map(String))})
            ORDER BY p.id
          `));
      add(targets);
      for (const row of staged) {
        count(`${stream}_staged`);
        add([stream, row.snapshot, evidence.get(Number(row.participant))]);
        const decision = decisions.get(Number(row.participant));
        const account = accounts.find((a) => Number(a.s1_id) === Number(row.account) && a.target != null);
        const found = targets.filter((t) => Number(t.nid) === Number(row.nid));
        const financialMapping = financialMappings.find((m) => Number(m.s1_id) === Number(row.nid));
        if (financialMapping && !found.some((t) => t.id === financialMapping.s2_id)) {
          count(`${stream}_mapped_target_missing_or_conflicting`);
          result.blocked++;
          continue;
        }
        if (!decision?.ok || !account || found.length > 1) {
          count(`${stream}_${!decision?.ok ? decision?.reason ?? "participant_missing" : !account ? "account_unmapped" : "duplicate_target"}`);
          // Known source rejects may never have loaded. They are not a
          // historical rebind candidate; the loader/parity reject policies
          // still decide whether their absence is permitted.
          if (found.length) result.blocked++;
          else count(`${stream}_unresolved_unloaded`);
          continue;
        }
        count(`${stream}_${decision.reason}`);
        if (!found.length) { count(`${stream}_missing_target`); continue; }
        const target = found[0];
        if (!target.owned || !target.ea || target.mappedId && target.mappedId !== target.id) {
          count(`${stream}_ownership_or_mapping_conflict`); result.blocked++; continue;
        }
        if (target.accountId !== account.s2_id) {
          count(`${stream}_fund_mismatch`); result.blocked++; continue;
        }
        const snapshot = row.snapshot as Record<string, unknown>;
        const raw = stream === "ar" ? snapshot.ledger_amount
          : (snapshot.fields as Record<string, unknown>)?.field_sirius_dollar_amt;
        const scalar = Array.isArray(raw) ? raw[0] : raw;
        const value = scalar && typeof scalar === "object" ? (scalar as Record<string, unknown>).value : scalar;
        const cents = toCents(String(value ?? ""));
        const targetCents = toCents(String((target.snapshot as Record<string, unknown>).amount ?? ""));
        attribute(`${stream}|${decision.entity.entityType}|${decision.entity.entityId}|${account.s2_id}`, "expected",
          stream === "payment" && cents != null ? Math.abs(cents) : cents);
        attribute(`${stream}|${target.entityType}|${target.entityId}|${target.accountId}`, "actual", targetCents);
        if (sameFinancialCoordinate(decision.entity, account.s2_id, target)) {
          count(`${stream}_matched`); continue;
        }
        count(`${stream}_identity_mismatch`);
        result.mismatched++;
        if (options.retainRebinds !== false) result.rebinds.push({ stream, id: target.id, oldEaId: target.eaId,
          accountId: account.s2_id, entity: decision.entity });
      }
    }
  }
  result.counts.attribution_coordinates = attribution.size;
  result.counts.attribution_mismatches = [...attribution.values()].filter((v) =>
    v.expectedCount !== v.actualCount || v.expectedCents !== v.actualCents).length;
  result.evidenceHash = hash.digest("hex");
  return result;
}

/** Aggregate financial invariants plus a complete row digest. Exclude ONLY
 * links of the EXACT approved candidate IDs; all other rows retain their EA.
 * Account ownership, reference links, annotations, dates and allocations are
 * included. Streaming avoids string_agg of the entire ledger in PostgreSQL. */
export async function financialFactsSnapshot(approved: { ar: Set<string>; payment: Set<string> }) {
  const hash = createHash("sha256");
  const totals = rowsOf(await getClient().execute(sql`
    SELECT 'ar' AS stream, ea.account_id, count(*)::text AS n, sum(l.amount)::text AS amount_total
    FROM ledger l LEFT JOIN ledger_ea ea ON ea.id = l.ea_id GROUP BY ea.account_id
    UNION ALL
    SELECT 'payment', ea.account_id, count(*)::text, sum(p.amount)::text
    FROM ledger_payments p LEFT JOIN ledger_ea ea ON ea.id = p.ledger_ea_id GROUP BY ea.account_id
    ORDER BY stream, account_id
  `));
  hash.update(canonicalJson(totals));
  for (const table of ["ledger", "ledger_payments", "ledger_ea"] as const) {
    let after = "";
    for (;;) {
      const rows = rowsOf<{ id: string; facts: Record<string, unknown> }>(await getClient().execute(sql`
        SELECT id, to_jsonb(t) AS facts
        FROM ${sql.identifier(table)} t WHERE id > ${after} ORDER BY id LIMIT 1000
      `));
      for (const row of rows) {
        if (table === "ledger" && approved.ar.has(row.id)) delete row.facts.ea_id;
        if (table === "ledger_payments" && approved.payment.has(row.id)) delete row.facts.ledger_ea_id;
        hash.update(canonicalJson([table, row]));
      }
      if (rows.length < 1000) break;
      after = rows[rows.length - 1].id;
    }
  }
  return { totals, hash: hash.digest("hex") };
}

export function publicFinancialInventory(result: FinancialLinkInventory) {
  const { rebinds: _private, ...aggregate } = result;
  return aggregate;
}
