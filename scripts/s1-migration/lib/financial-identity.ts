import { sql } from "drizzle-orm";
import { getClient } from "../../../server/storage/transaction-context";
import { planFinancialIdentity, type IdentityDecision, type IdentityEvidence } from "./financial-identity-plan";

export const rowsOf = <T>(value: unknown): T[] => (value as { rows: T[] }).rows;
const inList = (values: Array<string | number>) => sql.join(values.map((v) => sql`${v}`), sql`, `);

export function financialReferenceNids(value: unknown): number[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((v) => {
    if (v && typeof v === "object") v = (v as Record<string, unknown>).target_id ?? (v as Record<string, unknown>).value;
    return typeof v === "number" || typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  }).filter((v) => Number.isSafeInteger(v) && v > 0))];
}

/** One narrow, keyset-paged source relationship scan per command, not per AR
 * page. The index retains explicit worker NIDs, including ambiguous claims. */
export async function loadFinancialSourceIndex() {
  const byContact = new Map<number, Array<{ nid: number; contactNids: number[] }>>();
  const byWorker = new Map<number, number[]>();
  let after = 0;
  for (;;) {
    const page = rowsOf<{ nid: string; fields: Record<string, unknown> }>(await getClient().execute(sql`
      SELECT nid, jsonb_build_object('field_sirius_contact', fields->'field_sirius_contact') AS fields
      FROM s1_staging.records WHERE bundle = 'sirius_worker' AND nid > ${after}
      ORDER BY nid LIMIT 5000
    `));
    for (const row of page) {
      const nid = Number(row.nid);
      const contactNids = financialReferenceNids(row.fields.field_sirius_contact);
      byWorker.set(nid, contactNids);
      for (const contact of contactNids) {
        const claims = byContact.get(contact) ?? [];
        claims.push({ nid, contactNids });
        byContact.set(contact, claims);
      }
    }
    if (page.length < 5000) break;
    after = Number(page[page.length - 1].nid);
  }
  return { byContact, byWorker };
}
export type FinancialSourceIndex = Awaited<ReturnType<typeof loadFinancialSourceIndex>>;

/** All mapping and destination reads are bounded by the caller's page. Reads
 * use the ambient transaction so repair evidence cannot escape its locks. */
export async function resolveFinancialPage(nids: Iterable<number>, source: FinancialSourceIndex) {
  const ids = [...new Set(nids)];
  const decisions = new Map<number, IdentityDecision>();
  const evidence = new Map<number, IdentityEvidence>();
  if (!ids.length) return { decisions, evidence };
  const related = new Set(ids);
  for (const nid of ids) {
    for (const w of source.byContact.get(nid) ?? []) related.add(w.nid);
    for (const c of source.byWorker.get(nid) ?? []) related.add(c);
  }
  type Mapping = { entity: string; s1_id: string; s2_id: string; s1_deleted_at: unknown; stub: boolean; loader: string };
  const mappings: Mapping[] = [];
  const relatedIds = [...related];
  for (let i = 0; i < relatedIds.length; i += 500) {
    mappings.push(...rowsOf<Mapping>(await getClient().execute(sql`
      SELECT entity, s1_id, s2_id, s1_deleted_at, stub, loader FROM s1_staging.id_map
      WHERE entity IN ('worker','shell-worker','contact','employer')
      AND s1_id IN (${inList(relatedIds.slice(i, i + 500))})
      ORDER BY entity, s1_id
    `)));
  }
  const byMapping = new Map(mappings.map((m) => [`${m.entity}:${m.s1_id}`, m]));
  const mapping = (entity: string, nid: number) => byMapping.get(`${entity}:${nid}`);
  const workerIds = mappings.filter((m) => m.entity === "worker" || m.entity === "shell-worker").map((m) => m.s2_id);
  const contactIds = mappings.filter((m) => m.entity === "contact").map((m) => m.s2_id);
  const employerIds = mappings.filter((m) => m.entity === "employer").map((m) => m.s2_id);
  const workers: Array<{ id: string; contactId: string }> = [];
  const contacts = new Set<string>();
  const employers = new Set<string>();
  for (let i = 0; i < Math.max(workerIds.length, contactIds.length, employerIds.length); i += 500) {
    const ws = workerIds.slice(i, i + 500), cs = contactIds.slice(i, i + 500), es = employerIds.slice(i, i + 500);
    if (ws.length || cs.length) workers.push(...rowsOf<{ id: string; contactId: string }>(await getClient().execute(sql`
      SELECT id, contact_id AS "contactId" FROM workers
      WHERE ${ws.length ? sql`id IN (${inList(ws)})` : sql`false`}
         OR ${cs.length ? sql`contact_id IN (${inList(cs)})` : sql`false`} ORDER BY id
    `)));
    if (cs.length) for (const c of rowsOf<{ id: string }>(await getClient().execute(sql`SELECT id FROM contacts WHERE id IN (${inList(cs)})`))) contacts.add(c.id);
    if (es.length) for (const e of rowsOf<{ id: string }>(await getClient().execute(sql`SELECT id FROM employers WHERE id IN (${inList(es)})`))) employers.add(e.id);
  }
  const destinationWorkers = [...new Map(workers.map((w) => [w.id, w])).values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const nid of ids) {
    // Direct worker nodes validate their OWN explicit contact relationship too.
    const directContacts = source.byWorker.get(nid);
    const claims = source.byContact.get(nid) ?? [];
    const contactNid = directContacts?.[0] ?? nid;
    const c = mapping("contact", contactNid);
    const e = mapping("employer", nid);
    const directShell = mapping("shell-worker", nid)?.s2_id;
    const contactShell = mapping("shell-worker", contactNid)?.s2_id;
    const sourceWorkers = directContacts
      ? directContacts.length === 1
        ? source.byContact.get(directContacts[0]) ?? [{ nid, contactNids: directContacts }]
        : [{ nid, contactNids: directContacts }]
      : claims;
    const ev: IdentityEvidence = {
      nid, sourceWorkers,
      directWorker: mapping("worker", nid)?.s2_id,
      shell: directShell ?? contactShell,
      contact: c?.s2_id, employer: e?.s2_id,
      workerMappings: sourceWorkers.map((w) => ({
        nid: w.nid, id: mapping("worker", w.nid)?.s2_id ?? null,
        retired: !!mapping("worker", w.nid)?.s1_deleted_at,
      })),
      destinationWorkers: destinationWorkers.filter((w) =>
        w.contactId === c?.s2_id || w.id === directShell || w.id === contactShell ||
        w.id === mapping("worker", nid)?.s2_id ||
        sourceWorkers.some((s) => mapping("worker", s.nid)?.s2_id === w.id)),
      contactExists: !!c && contacts.has(c.s2_id),
      employerExists: !!e && employers.has(e.s2_id),
      retired: ["worker", "shell-worker", "employer"].some((kind) => !!mapping(kind, nid)?.s1_deleted_at) || !!c?.s1_deleted_at,
    };
    evidence.set(nid, ev);
    decisions.set(nid, directShell && contactShell && directShell !== contactShell
      ? { ok: false, reason: "competing_shell_mapping" }
      : planFinancialIdentity(ev));
  }
  return { decisions, evidence };
}
