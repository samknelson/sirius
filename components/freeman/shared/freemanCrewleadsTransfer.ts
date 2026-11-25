import {
  summarizeOptionsImport,
  type OptionsImportPlanItem,
  type OptionsImportProblem,
} from "../../../shared/optionsTransfer";

export const CREW_LEADS_TRANSFER_TYPE = "freeman-crew-leads";
export type CrewLeadsImportMode = "merge" | "replace";
export interface CrewLeadTransferRecord {
  name: string;
  siriusId: string;
}
export interface CrewLeadsExport {
  type: typeof CREW_LEADS_TRANSFER_TYPE;
  exportedAt: string;
  records: CrewLeadTransferRecord[];
}
export interface CrewLeadsImportItem extends OptionsImportPlanItem {
  siriusId: string;
}
export interface CrewLeadsImportPlan {
  items: CrewLeadsImportItem[];
  errors: OptionsImportProblem[];
  summary: ReturnType<typeof summarizeOptionsImport>;
  /** Empty JSON [] is explicit; empty/whitespace text is never a clear request. */
  clearAll: boolean;
}
export interface CrewLeadsImportResult extends CrewLeadsImportPlan {
  token: string;
  applied: boolean;
  stale?: boolean;
}

/** Pure planner shared by preview and apply; never reads/writes application data. */
export function planCrewLeadsImport(
  text: string,
  mode: CrewLeadsImportMode,
  existing: Array<CrewLeadTransferRecord & { id: string }>,
): CrewLeadsImportPlan {
  const errors: OptionsImportProblem[] = [];
  const items: CrewLeadsImportItem[] = [];
  const fail = (position: number | null, message: string) =>
    errors.push({ position, name: null, message });
  const input = text.replace(/^\uFEFF/, "").trim();
  const records: Array<{ raw: unknown; position: number }> = [];
  let explicitEmpty = false;
  if (!input) {
    fail(null, "Paste JSON or Name | Sirius ID lines. Blank input cannot clear the list.");
  } else if (/^[{["]|^(null|true|false)\b/.test(input)) {
    try {
      const json: unknown = JSON.parse(input);
      const envelope = json as Partial<CrewLeadsExport> | null;
      const list = Array.isArray(json) ? json :
        envelope?.type === CREW_LEADS_TRANSFER_TYPE ? envelope.records : undefined;
      if (!Array.isArray(list)) {
        fail(null, `Expected a records array with type "${CREW_LEADS_TRANSFER_TYPE}", or a bare JSON array.`);
      } else {
        explicitEmpty = list.length === 0;
        list.forEach((raw, i) => records.push({ raw, position: i + 1 }));
      }
    } catch {
      fail(null, "Invalid JSON. Fix its syntax before importing.");
    }
  } else {
    input.split(/\r\n|\n|\r/).forEach((line, i) => {
      if (!line.trim()) return;
      const fields = line.split(/[|\t]/);
      if (fields.length !== 2) {
        fail(i + 1, "Expected exactly Name | Sirius ID (or two tab-separated values).");
      } else {
        records.push({ raw: { name: fields[0], siriusId: fields[1] }, position: i + 1 });
      }
    });
  }

  const bySirius = new Map<string, typeof existing>();
  for (const row of existing) {
    const key = row.siriusId.trim();
    const matches = bySirius.get(key) ?? [];
    matches.push(row);
    bySirius.set(key, matches);
  }
  for (const [key, matches] of bySirius) {
    if (!key || matches.length > 1) fail(null, `Existing Sirius ID "${key}" is blank or ambiguous. Correct existing records first.`);
  }
  const seen = new Map<string, number>();
  for (const { raw, position } of records) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fail(position, "Expected a record with string name and siriusId fields.");
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim() ||
        typeof record.siriusId !== "string" || !record.siriusId.trim()) {
      fail(position, "Name and Sirius ID must both be non-empty strings. Quote JSON IDs to preserve leading zeroes.");
      continue;
    }
    const name = record.name.trim();
    const siriusId = record.siriusId.trim();
    if (seen.has(siriusId)) {
      fail(position, `Duplicate Sirius ID "${siriusId}" (first appears at row ${seen.get(siriusId)}).`);
      continue;
    }
    seen.set(siriusId, position);
    const row = bySirius.get(siriusId)?.[0];
    const changes = !row
      ? [{ field: "name", from: null, to: name }, { field: "siriusId", from: null, to: siriusId }]
      : row.name === name ? [] : [{ field: "name", from: row.name, to: name }];
    items.push({
      position, name, siriusId, existingId: row?.id ?? null, changes,
      action: !row ? "create" : changes.length ? "update" : "unchanged",
    });
  }
  // Never offer a destructive plan for a partly parsed/invalid file.
  if (mode === "replace" && errors.length === 0) {
    for (const row of existing) {
      if (!seen.has(row.siriusId.trim())) items.push({
        position: null, name: row.name, siriusId: row.siriusId, existingId: row.id,
        action: "delete", changes: [],
      });
    }
  }
  return { items, errors, summary: summarizeOptionsImport(items), clearAll: mode === "replace" && explicitEmpty };
}
