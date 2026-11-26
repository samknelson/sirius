/** Pure B3 precedence. No payload from this module may be printed. */
export const D7_CATEGORIES = [
  "comment", "call from member", "office visit", "call to member",
  "issue reported for member", "letter", "helpline call from member",
  "worker:member_status", "onsite visit", "smf:notes", "email from member",
] as const;
export const FILE_TYPES = [
  ["member-document", "Member Document", "worker"],
  ["election-document", "Election Document", "worker"],
  ["note-attachment", "Note Attachment", "worker"],
  ["employer-contract", "Employer Contract", "employer"],
  ["employer-document", "Employer Document", "employer"],
  ["payment-document", "Payment Document", "ledger_payment"],
] as const;
export type FileContext = "worker" | "employer" | "ledger_payment";
export type FileType = typeof FILE_TYPES[number][0];
export interface SourceNode { nid: number; bundle: string; title: string | null; fields: Record<string, unknown> }
export interface Owner { context?: FileContext; id?: string; reason?: string; kind: string }
export interface Candidate {
  fid: number; sourceNid: number; sourceBundle: string; sourceField: string;
  category: string; type: string; context?: FileContext; ownerId?: string;
  typeKey?: FileType; reason?: string; archiveOnly?: boolean;
  title?: string; summary?: string; materialType?: string;
  relationshipNid?: number; wizardStatus?: string;
}
const array = (v: unknown): unknown[] => Array.isArray(v) ? v : v == null ? [] : [v];
export const object = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, any> : {};
export function scalar(v: unknown): any {
  const first = array(v)[0];
  return first && typeof first === "object" && "value" in first ? first.value : first;
}
export const text = (v: unknown): string => String(scalar(v) ?? "").trim();
export const normalize = (v: unknown): string => text(v).toLowerCase().replace(/\s+/g, " ");
export function references(v: unknown): number[] {
  return array(v).map(x => Number(typeof x === "object" ? object(x).target_id ?? object(x).value : x))
    .filter(n => Number.isSafeInteger(n) && n > 0);
}
export function fileIds(v: unknown): number[] {
  return array(v).map(x => Number(object(x).fid)).filter(n => Number.isSafeInteger(n) && n > 0);
}
export function sourceJson(node: SourceNode): Record<string, any> {
  const raw = scalar(node.fields.field_sirius_json);
  if (typeof raw === "string") {
    try { return object(JSON.parse(raw)); } catch { throw new Error("source_json_invalid"); }
  }
  return object(raw);
}
export const categoryOf = (n: SourceNode) => normalize(n.fields.field_sirius_log_category ?? n.fields.field_sirius_category);
export const typeOf = (n: SourceNode) => normalize(n.fields.field_sirius_log_type ?? n.fields.field_sirius_type);
export function mergeResolver(logs: SourceNode[]) {
  const edges = new Map<number, number>();
  const invalid = new Set<number>();
  let invalidLogs = 0;
  for (const n of logs) {
    if (categoryOf(n) !== "sirius_worker" || typeOf(n) !== "merge") continue;
    let json: Record<string, any>;
    try { json = sourceJson(n); } catch { invalidLogs++; continue; }
    const from = Number(json.nid);
    const handlers = references(n.fields.field_sirius_log_handler);
    const fromKnown = Number.isSafeInteger(from) && from > 0;
    if (!fromKnown || handlers.length !== 1) {
      invalidLogs++;
      if (fromKnown) invalid.add(from);
      continue;
    }
    if (edges.has(from) && edges.get(from) !== handlers[0]) invalid.add(from);
    edges.set(from, handlers[0]);
  }
  const resolve = (nid: number): number | undefined => {
    const seen = new Set<number>();
    for (;;) {
      if (invalid.has(nid) || seen.has(nid)) return undefined;
      seen.add(nid);
      const next = edges.get(nid);
      if (next === undefined) return nid;
      nid = next;
    }
  };
  return Object.assign(resolve, { invalidLogs });
}
/** Walk explicit fid/relationship pairs, including inherited relationship nodes. */
function relationshipFor(value: unknown, fid: number, inherited?: number): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = object(value);
  const relation = Number(obj.relationship_nid) || inherited;
  if (Number(obj.fid) === fid && relation) return relation;
  for (const [key, child] of Object.entries(value)) {
    if (Number(key) === fid && Number(object(child).relationship_nid) > 0) return Number(object(child).relationship_nid);
    const found = relationshipFor(child, fid, relation);
    if (found) return found;
  }
}
export function buildCandidates(
  nodes: SourceNode[], resolveOwner: (nid: number) => Owner, resolveMerge: (nid: number) => number | undefined,
): Candidate[] {
  const out: Candidate[] = [];
  for (const node of [...nodes].sort((a, b) => a.nid - b.nid)) {
    const fields = node.bundle === "grievance_shop"
      ? ["field_grievance_contract", "field_grievance_attachments"] : ["field_sirius_attachments"];
    for (const field of fields) for (const fid of fileIds(node.fields[field])) {
      const c: Candidate = { fid, sourceNid: node.nid, sourceBundle: node.bundle, sourceField: field,
        category: categoryOf(node), type: typeOf(node) };
      out.push(c);
      if (node.bundle === "grievance_shop") {
        const owner = resolveOwner(node.nid);
        c.context = "employer"; c.ownerId = owner.id; c.reason = owner.reason;
        c.typeKey = field === "field_grievance_contract" ? "employer-contract" : "employer-document";
        continue;
      }
      if (["feed:prior", "auditlog"].includes(c.category)) { c.archiveOnly = true; continue; }
      const election = c.category.startsWith("trust:election_wizard");
      let json: Record<string, any> = {};
      if (election || c.category === "material") {
        try { json = sourceJson(node); }
        catch { c.reason = "source_json_invalid"; continue; }
      }
      const resolved = references(node.fields.field_sirius_log_handler).map(n => resolveMerge(n));
      if (resolved.some(n => n === undefined)) { c.reason = "merge_unresolved"; continue; }
      const owners = resolved.map(n => resolveOwner(n!));
      const workers = owners.filter(o => o.kind === "worker");
      let worker = workers.find(o => o.id);
      if (workers.some(o => o.reason === "worker_ambiguous") ||
          new Set(workers.map(o => o.id).filter(Boolean)).size > 1) {
        c.reason = "worker_ambiguous"; continue;
      }
      if (!worker && election && workers.length === 0) {
        const nid = Number(json.wizard?.trust_election?.policy?.worker_nid);
        if (Number.isSafeInteger(nid) && nid > 0) {
          const merged = resolveMerge(nid);
          if (merged === undefined) { c.reason = "merge_unresolved"; continue; }
          const fallback = resolveOwner(merged);
          if (fallback.kind === "worker") worker = fallback;
        }
      }
      worker ??= workers[0];
      if (worker) {
        c.context = "worker"; c.ownerId = worker.id; c.reason = worker.reason;
        if (c.category === "material") {
          c.typeKey = "member-document";
          c.title = text(json.material?.title) || undefined;
          c.materialType = text(node.fields.field_sirius_type);
          c.summary = text(node.fields.field_sirius_summary);
        } else if (election) {
          c.typeKey = "election-document"; c.wizardStatus = c.type;
          c.relationshipNid = relationshipFor(json, fid);
        } else if ((D7_CATEGORIES as readonly string[]).includes(c.category)) c.typeKey = "note-attachment";
        else c.reason = "category_unruled";
        continue;
      }
      const payment = owners.find(o => o.kind === "payment");
      const employer = owners.find(o => o.kind === "employer");
      const owner = payment ?? employer;
      if (owner) {
        c.context = payment ? "ledger_payment" : "employer"; c.ownerId = owner.id; c.reason = owner.reason;
        c.typeKey = payment ? "payment-document" : "employer-document";
      } else if (owners.some(o => o.kind === "archive") || (owners.length && owners.every(o => o.kind === "unstaged"))) {
        c.archiveOnly = true;
      } else c.reason = "owner_unresolved";
    }
  }
  const claimed = new Set<number>();
  for (const c of out) {
    if (c.archiveOnly) continue;
    if (claimed.has(c.fid)) c.reason = "duplicate_fid";
    else claimed.add(c.fid);
  }
  return out;
}
