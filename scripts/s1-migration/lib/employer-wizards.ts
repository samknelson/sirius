import type { HistoricalEmployerUpload } from "../../../shared/historical-employer-upload";
import approved from "../../../docs/s1-migration/employer-wizard-approved-rejects.json";

export const EMPLOYER_WIZARD_LOADER = "s1-employer-wizards";
export const EMPLOYER_WIZARD_ENTITY = "s1_employer_wizard";
export const APPROVED_HISTORY_REJECT = "approved_historical_upload";
export const SOURCE_TYPES = ["sirius_smf_feed_ehrs", "sirius_smf_feed_ehrs_correction"] as const;

export interface SourceUploadNode {
  nid: number;
  created: number | null;
  changed: number | null;
  fields: Record<string, unknown>;
}
export function fieldValues(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}
export function singleField(value: unknown): unknown {
  const values = fieldValues(value);
  if (values.length !== 1) return undefined;
  const v = values[0];
  return v && typeof v === "object" ? (v as Record<string, unknown>).value : v;
}
export function reference(value: unknown): number | undefined {
  const v = value && typeof value === "object"
    ? (value as Record<string, unknown>).target_id : value;
  const n = typeof v === "number" || (typeof v === "string" && /^[1-9]\d*$/.test(v)) ? Number(v) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
export function approvedReject(nid: number, reason: string): boolean {
  if (reason === "missing_upload_parent") return approved.missing_upload_parent.includes(nid);
  if (reason === "missing_employer_node") return approved.missing_employer_node.includes(nid);
  return false;
}

export function indexUploadParents(parents: SourceUploadNode[]): Map<number, SourceUploadNode[]> {
  const index = new Map<number, SourceUploadNode[]>();
  for (const parent of parents) {
    if (!fieldValues(parent.fields.field_sirius_category).some(v => singleField(v) === "smf:ehrs")) continue;
    for (const value of fieldValues(parent.fields.field_sirius_log_handler)) {
      const nid = reference(value);
      if (!nid) continue;
      const list = index.get(nid) ?? [];
      list.push(parent); // Duplicate handler rows intentionally remain ambiguous.
      index.set(nid, list);
    }
  }
  return index;
}

export type SourceResolution =
  | { kind: "out_of_scope" }
  | { kind: "reject"; reason: string }
  | { kind: "resolved"; history: HistoricalEmployerUpload };

export function resolveUpload(
  feed: SourceUploadNode,
  parentIndex: Map<number, SourceUploadNode[]>,
  liveEmployers: Set<number>,
): SourceResolution {
  const fields = feed.fields;
  const type = singleField(fields.field_sirius_type);
  if (typeof type !== "string") return { kind: "reject", reason: "ambiguous_source_type" };
  if (!(SOURCE_TYPES as readonly string[]).includes(type)) {
    // Observed malformed type "complete" must not disappear as an unrelated feed.
    return type === "complete" ? { kind: "reject", reason: "unsupported_source_type" } : { kind: "out_of_scope" };
  }
  const reject = (reason: string): SourceResolution => ({ kind: "reject", reason });
  const status = singleField(fields.field_sirius_feed_status);
  if (status !== "complete" && status !== "draft") return reject("unsupported_source_status");
  if (!Number.isSafeInteger(feed.created) || feed.created! <= 0 || feed.created! > 4102444800) return reject("invalid_source_timestamp");
  const parents = parentIndex.get(feed.nid) ?? [];
  if (!parents.length) return reject("missing_upload_parent");
  if (parents.length !== 1) return reject("ambiguous_upload_parent");
  const parent = parents[0];
  if (singleField(parent.fields.field_sirius_category) !== "smf:ehrs") return reject("ambiguous_parent_category");
  const key = singleField(parent.fields.field_sirius_notes);
  const parsed = typeof key === "string" ? /^([1-9]\d*)\/([12]\d{3})\/(0?[1-9]|1[0-2])$/.exec(key) : null;
  if (!parsed) return reject("invalid_reporting_key");
  const [, employerText, yearText, monthText] = parsed;
  const employerNid = Number(employerText), year = Number(yearText), month = Number(monthText);
  if (!Number.isSafeInteger(employerNid) || year < 1900 || year > 2100) return reject("invalid_reporting_key");
  const handlers = fieldValues(parent.fields.field_sirius_log_handler).map(reference);
  if (handlers.some(v => v === undefined)) return reject("invalid_parent_handler");
  const employerHandlers = handlers.filter(nid => liveEmployers.has(nid!));
  const refs = fieldValues(fields.field_grievance_shop).map(reference);
  if (refs.length > 1 || refs.some(v => v === undefined)) return reject("ambiguous_feed_employer");
  if (refs.length && refs[0] !== employerNid) return reject("feed_employer_conflict");
  if (!liveEmployers.has(employerNid)) {
    return reject(handlers.filter(nid => nid === employerNid).length === 1 && employerHandlers.length === 0
      ? "missing_employer_node" : "ambiguous_parent_employer");
  }
  if (employerHandlers.length !== 1 || employerHandlers[0] !== employerNid) return reject("ambiguous_parent_employer");
  const raw = singleField(fields.field_sirius_json);
  let root: any;
  if (raw != null) {
    try {
      const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
      root = payload?.wizard?.[type];
    } catch { return reject("invalid_source_json"); }
  }
  const flag = (step: string): boolean | null =>
    typeof root?.steps?.[step]?.complete === "boolean" ? root.steps[step].complete : null;
  return { kind: "resolved", history: {
    kind: "s1-employer-upload", version: 1, feedNid: feed.nid, parentNid: parent.nid,
    employerNid, sourceType: type, sourceStatus: status,
    createdEpoch: feed.created!, changedEpoch: feed.changed, year, month,
    postComplete: flag("post"), reviewComplete: flag("review"), fileAvailable: false,
  } };
}
