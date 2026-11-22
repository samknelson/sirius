import { sql } from "drizzle-orm";
import { db } from "../../../server/storage/db";
import { getAllMappings } from "./idmap";
import { buildCandidates, mergeResolver, references, sourceJson, categoryOf, type SourceNode, type Owner } from "./file-candidates";
import type { RawFile } from "./file-staging";

export async function loadFileSource() {
  const rows = <T>(r: unknown) => (r as { rows: T[] }).rows;
  const fieldText = (key: string) => sql`COALESCE(
    fields->${key}->0->>'value', fields->${key}->>0,
    fields->${key}->>'value', fields->>${key})`;
  const normalized = (value: ReturnType<typeof sql>) => sql`lower(regexp_replace(btrim(${value}), '\\s+', ' ', 'g'))`;
  const nodes = rows<SourceNode>(await db.execute(sql`SELECT nid,bundle,title,fields FROM s1_staging.records
    WHERE bundle='grievance_shop' OR (bundle='sirius_log' AND
      (fields ? 'field_sirius_attachments' OR
       (${normalized(sql`COALESCE(${fieldText("field_sirius_log_category")},${fieldText("field_sirius_category")})`)}='sirius_worker'
        AND ${normalized(sql`COALESCE(${fieldText("field_sirius_log_type")},${fieldText("field_sirius_type")})`)}='merge')))
    ORDER BY nid`)).map(n => ({ ...n, nid: Number(n.nid) }));
  const needed = new Set<number>();
  for (const node of nodes) {
    needed.add(node.nid);
    for (const nid of references(node.fields.field_sirius_log_handler)) needed.add(nid);
    let json: Record<string, any> = {};
    // Candidate construction reports malformed election payloads per file.
    if (categoryOf(node).startsWith("trust:election_wizard")) {
      try { json = sourceJson(node); } catch { continue; }
    }
    const fallback = Number(json.wizard?.trust_election?.policy?.worker_nid);
    if (Number.isSafeInteger(fallback) && fallback > 0) needed.add(fallback);
  }
  const bundles = new Map<number, string>();
  const ids = [...needed];
  for (let i = 0; i < ids.length; i += 1000) {
    const identities = rows<{ nid: string; bundle: string }>(await db.execute(sql`SELECT nid,bundle FROM s1_staging.records
      WHERE nid IN (${sql.join(ids.slice(i, i + 1000).map(n => sql`${n}`), sql`,`)})`));
    for (const n of identities) bundles.set(Number(n.nid), n.bundle);
  }
  const [workers, contacts, employers, payments, users, notes] = await Promise.all(
    ["worker", "contact", "employer", "payment", "user", "s1_log_note"].map(getAllMappings));
  const liveWorkers = rows<{ id: string; contact_id: string | null }>(await db.execute(sql`SELECT id,contact_id FROM workers`));
  const byId = new Set(liveWorkers.map(w => w.id));
  const byContact = new Map<string, string[]>();
  for (const w of liveWorkers) if (w.contact_id) byContact.set(w.contact_id, [...(byContact.get(w.contact_id) ?? []), w.id]);
  const employerIds = new Set(rows<{ id: string }>(await db.execute(sql`SELECT id FROM employers`)).map(r => r.id));
  const paymentIds = new Set(rows<{ id: string }>(await db.execute(sql`SELECT id FROM ledger_payments`)).map(r => r.id));
  const userIds = new Set(rows<{ id: string }>(await db.execute(sql`SELECT id FROM users`)).map(r => r.id));
  const resolveOwner = (nid: number): Owner => {
    const bundle = bundles.get(nid);
    if (bundle === "sirius_worker" || bundle === "sirius_contact") {
      const direct = workers.get(nid);
      if (direct && byId.has(direct.s2Id)) return { kind: "worker", context: "worker", id: direct.s2Id };
      const contact = contacts.get(nid);
      const matches = contact ? byContact.get(contact.s2Id) ?? [] : [];
      return { kind: "worker", context: "worker", id: matches.length === 1 ? matches[0] : undefined,
        reason: matches.length === 1 ? undefined : matches.length > 1 ? "worker_ambiguous" : "worker_unmapped" };
    }
    if (bundle === "grievance_shop") {
      const id = employers.get(nid)?.s2Id;
      return { kind: "employer", context: "employer", id: id && employerIds.has(id) ? id : undefined,
        reason: id && employerIds.has(id) ? undefined : "employer_unmapped" };
    }
    if (bundle === "sirius_payment") {
      const id = payments.get(nid)?.s2Id;
      return { kind: "payment", context: "ledger_payment", id: id && paymentIds.has(id) ? id : undefined,
        reason: id && paymentIds.has(id) ? undefined : "payment_unmapped" };
    }
    return { kind: !bundle ? "unstaged" : ["sirius_feed", "sirius_payperiod"].includes(bundle) ? "archive" : "other" };
  };
  const resolveMerge = mergeResolver(nodes);
  const candidates = buildCandidates(nodes, resolveOwner, resolveMerge);
  const terms = new Map(rows<{ tid: string; name: string }>(await db.execute(sql`SELECT tid,name FROM s1_staging.terms`)).map(r => [Number(r.tid), r.name]));
  for (const c of candidates) if (c.materialType && /^\d+$/.test(c.materialType)) {
    c.materialType = terms.get(Number(c.materialType)) ?? c.materialType;
  }
  const rawFiles = rows<RawFile>(await db.execute(sql`SELECT * FROM s1_staging.raw_file_managed`))
    .map(r => ({ ...r, fid: Number(r.fid), uid: Number(r.uid), filesize: Number(r.filesize), timestamp: Number(r.timestamp) }));
  return { candidates, mergeLogInvalid: resolveMerge.invalidLogs, rawFiles: new Map(rawFiles.map(r => [r.fid, r])), notes,
    uploader: (uid: number) => {
      const m = users.get(uid);
      return m && !m.stub && userIds.has(m.s2Id) ? m.s2Id : "system:s1-migration";
    } };
}
