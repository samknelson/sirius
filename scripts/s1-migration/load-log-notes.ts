/**
 * S1 sirius_log → S2 worker notes importer.
 *
 * This is intentionally not a fork of load-call-logs.ts. The workbook-approved
 * rows become notes with BAO tags; every other sirius_log disposition remains
 * out of scope. Output and diagnostics are aggregates only.
 */
import { db } from "../../server/storage/db";
import { storage } from "../../server/storage/database";
import { sql } from "drizzle-orm";
import {
  withNotificationsSuppressed,
  withChargePluginsSuppressed,
} from "../../server/middleware/request-context";
import { ensureStagingSchema, recordRun } from "./lib/staging";
import {
  advanceFingerprints,
  deleteMappings,
  ensureIdMap,
  getAllMappings,
  getMappings,
  putMappings,
  type MappingInfo,
} from "./lib/idmap";
import { ensureRawUserTables } from "./lib/staging";
import { RejectLog, chunk, strOf, throttleStorageOpLogs, LOADER_PAGE_SIZE } from "./lib/loader-utils";
import { makeProgressLogger } from "./lib/progress";
import {
  buildLoaderResult,
  classifyRow,
  combineFingerprints,
  emitLoaderResult,
  emptySummary,
  loaderExitCode,
  parseAllowedFindings,
  parseForceReconcile,
  sweepDeletions,
} from "./lib/sync";
import {
  ISSUE_TAG_ID_BY_NAME,
  NOTE_TYPE_DEFINITIONS,
  TAG_DEFINITIONS,
  TAG_TYPE_DEFINITIONS,
  classifyS1Log,
  deriveS1LogNoteSubject,
  extractS1LogNoteBody,
  resolveS1LogCreator,
  type S1LogCreator,
  type LogNoteClassification,
} from "./lib/log-notes";
import { contentHashOf, type DeletionCandidate } from "./lib/sync";

const DRY_RUN = process.argv.includes("--dry-run");
const MIGRATION_MODE = process.argv.includes("--migration-mode");
const FORCE_RECONCILE = parseForceReconcile();
const ALLOWED_FINDINGS = parseAllowedFindings();
const ALLOWED_REJECTS = (() => {
  const i = process.argv.indexOf("--allow-rejects");
  return i >= 0 ? String(process.argv[i + 1] ?? "").split(",").filter(Boolean) : [];
})();
const LOADER = "s1-log-notes";
const ID_MAP_ENTITY = "s1_log_note";
const LOGIC_VERSION = 3;
const FATAL_REASONS = ["timestamp_missing", "create_failed", "update_failed"] as const;

function targetNidsOf(fields: Record<string, unknown>, key: string): number[] {
  const raw = fields[key];
  const values = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return values.map((value) => {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
    if (value && typeof value === "object") {
      const candidate = (value as Record<string, unknown>).target_id ?? (value as Record<string, unknown>).value;
      if (typeof candidate === "number") return candidate;
      if (typeof candidate === "string" && /^\d+$/.test(candidate)) return Number(candidate);
    }
    return null;
  }).filter((value): value is number => value !== null);
}

function loaderScope<T>(fn: () => Promise<T>): Promise<T> {
  return MIGRATION_MODE
    ? withChargePluginsSuppressed(() => withNotificationsSuppressed(fn))
    : withNotificationsSuppressed(fn);
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function ensureNoteOptions(): Promise<{
  noteTypeIds: Map<string, string>;
  tagIds: Map<string, string>;
}> {
  const tables = await db.execute(sql`
    SELECT to_regclass('public.options_note_type') AS note_type,
           to_regclass('public.options_sitespecific_bao_notes_tag_types') AS tag_type,
           to_regclass('public.options_sitespecific_bao_notes_tags') AS tag,
           to_regclass('public.sitespecific_bao_notes_tags') AS assignment
  `);
  const tableRow = (tables as unknown as { rows: Array<Record<string, string | null>> }).rows[0];
  if (!tableRow?.note_type || !tableRow.tag_type || !tableRow.tag || !tableRow.assignment) {
    throw new Error("ABORTING: notes and BAO note-tag component tables are required before s1-log-notes");
  }

  const noteTypeIds = new Map<string, string>();
  for (const definition of NOTE_TYPE_DEFINITIONS) {
    const existing = await db.execute(sql`
      SELECT id, name, description, data FROM options_note_type WHERE sirius_id = ${definition.id}
    `);
    const rows = (existing as unknown as { rows: Array<{ id: string; name: string; description: string | null; data: unknown }> }).rows;
    if (rows.length > 1) throw new Error(`ABORTING: duplicate note type Sirius ID ${definition.id}`);
    let row = rows[0];
    if (!row) {
      const sameName = await db.execute(sql`SELECT id FROM options_note_type WHERE name = ${definition.name}`);
      if ((sameName as unknown as { rows: unknown[] }).rows.length > 0) {
        throw new Error(`ABORTING: note type "${definition.name}" exists without the S1 source identity`);
      }
      if (DRY_RUN) throw new Error(`ABORTING: dry-run requires note type "${definition.name}" to already exist`);
      const inserted = await db.execute(sql`
        INSERT INTO options_note_type (id, name, description, sirius_id, data)
        VALUES (
          ${`s1-log-note-type-${definition.id}`}, ${definition.name}, ${definition.description},
          ${definition.id}, ${JSON.stringify({ contextIds: ["worker"], s1SourceId: `s1-log-note:type:${definition.id}`, order: definition.order })}::jsonb
        ) RETURNING id, name, description, data
      `);
      row = (inserted as unknown as { rows: typeof rows }).rows[0];
    } else {
      const data = jsonObject(row.data);
      const entities = Array.isArray(data.contextIds) ? data.contextIds : [];
      if (row.name !== definition.name || !entities.includes("worker") || data.s1SourceId !== `s1-log-note:type:${definition.id}`) {
        throw new Error(`ABORTING: incompatible note type definition for ${definition.id}`);
      }
      if (!DRY_RUN) {
        await db.execute(sql`
          UPDATE options_note_type
             SET description = ${definition.description},
                 data = COALESCE(data, '{}'::jsonb) || ${JSON.stringify({ contextIds: ["worker"], s1SourceId: `s1-log-note:type:${definition.id}`, order: definition.order })}::jsonb
           WHERE id = ${row.id}
        `);
      }
    }
    noteTypeIds.set(definition.name, row.id);
  }

  const tagTypeIds = new Map<string, string>();
  for (const definition of TAG_TYPE_DEFINITIONS) {
    const sourceId = `s1-log-notes:tag-type:${definition.id}`;
    const existing = await db.execute(sql`
      SELECT id, name, description, sequence, data
        FROM options_sitespecific_bao_notes_tag_types
       WHERE data->>'s1SourceId' = ${sourceId}
    `);
    const rows = (existing as unknown as { rows: Array<{ id: string; name: string; description: string | null; sequence: number; data: unknown }> }).rows;
    if (rows.length > 1) throw new Error(`ABORTING: duplicate BAO tag type source identity ${definition.id}`);
    let row = rows[0];
    if (!row) {
      const sameName = await db.execute(sql`
        SELECT id FROM options_sitespecific_bao_notes_tag_types WHERE name = ${definition.name}
      `);
      if ((sameName as unknown as { rows: unknown[] }).rows.length > 0) {
        throw new Error(`ABORTING: BAO tag type "${definition.name}" exists without the S1 source identity`);
      }
      if (DRY_RUN) throw new Error(`ABORTING: dry-run requires BAO tag type "${definition.name}" to already exist`);
      const inserted = await db.execute(sql`
        INSERT INTO options_sitespecific_bao_notes_tag_types (id, name, description, sequence, data)
        VALUES (
          ${`s1-log-note-tag-type-${definition.id}`}, ${definition.name}, ${definition.description},
          ${definition.sequence}, ${JSON.stringify({ s1SourceId: sourceId })}::jsonb
        ) RETURNING id, name, description, sequence, data
      `);
      row = (inserted as unknown as { rows: typeof rows }).rows[0];
    } else {
      if (row.name !== definition.name) throw new Error(`ABORTING: incompatible BAO tag type definition for ${definition.id}`);
      if (!DRY_RUN) {
        await db.execute(sql`
          UPDATE options_sitespecific_bao_notes_tag_types
             SET description = ${definition.description}, sequence = ${definition.sequence}
           WHERE id = ${row.id}
        `);
      }
    }
    tagTypeIds.set(definition.id, row.id);
  }

  const tagIds = new Map<string, string>();
  for (const [sourceId, name, typeId, sequence] of TAG_DEFINITIONS) {
    const tagTypeDbId = tagTypeIds.get(typeId);
    if (!tagTypeDbId) throw new Error(`ABORTING: missing tag type ${typeId}`);
    const identity = `s1-log-notes:tag:${sourceId}`;
    const existing = await db.execute(sql`
      SELECT id, name, tag_type_id AS "tagTypeId", description, sequence, data
        FROM options_sitespecific_bao_notes_tags
       WHERE data->>'s1SourceId' = ${identity}
    `);
    const rows = (existing as unknown as { rows: Array<{ id: string; name: string; tagTypeId: string; description: string | null; sequence: number; data: unknown }> }).rows;
    if (rows.length > 1) throw new Error(`ABORTING: duplicate BAO tag source identity ${sourceId}`);
    let row = rows[0];
    if (!row) {
      const sameName = await db.execute(sql`
        SELECT id FROM options_sitespecific_bao_notes_tags
         WHERE tag_type_id = ${tagTypeDbId} AND name = ${name}
      `);
      if ((sameName as unknown as { rows: unknown[] }).rows.length > 0) {
        throw new Error(`ABORTING: BAO tag "${name}" exists without the S1 source identity`);
      }
      if (DRY_RUN) throw new Error(`ABORTING: dry-run requires BAO tag "${name}" to already exist`);
      const inserted = await db.execute(sql`
        INSERT INTO options_sitespecific_bao_notes_tags (id, name, tag_type_id, description, sequence, data)
        VALUES (
          ${`s1-log-note-tag-${sourceId}`}, ${name}, ${tagTypeDbId}, ${`Imported S1 ${typeId} tag.`},
          ${sequence}, ${JSON.stringify({ s1SourceId: identity })}::jsonb
        ) RETURNING id, name, tag_type_id AS "tagTypeId", description, sequence, data
      `);
      row = (inserted as unknown as { rows: typeof rows }).rows[0];
    } else {
      if (row.name !== name || row.tagTypeId !== tagTypeDbId) {
        throw new Error(`ABORTING: incompatible BAO tag definition for ${sourceId}`);
      }
      if (!DRY_RUN) {
        await db.execute(sql`
          UPDATE options_sitespecific_bao_notes_tags
             SET description = ${`Imported S1 ${typeId} tag.`}, sequence = ${sequence}
           WHERE id = ${row.id}
        `);
      }
    }
    tagIds.set(sourceId, row.id);
  }
  return { noteTypeIds, tagIds };
}

interface StagedLog {
  nid: number;
  title: string | null;
  uid: number | null;
  created: number | null;
  fields: Record<string, unknown>;
  contentHash: string | null;
}
type RawLog = {
  nid: string | number;
  title: string | null;
  uid: string | number | null;
  created: string | number | null;
  fields: unknown;
  content_hash: string | null;
};

/**
 * SQL mirror of `sourceValue(...)` + `norm(...)` for one staged field key:
 * first array element, `{value}` unwrap, trim, empty→NULL. Only used by the
 * immutable-skip predicate below, which additionally requires a COMPLETED
 * mapping — a shape this mirror mis-reads simply flows through the ordinary
 * JS classification path.
 */
function stagedFieldTextSql(key: string) {
  return sql`
    NULLIF(btrim(CASE jsonb_typeof(r.fields->${key})
      WHEN 'array' THEN CASE WHEN jsonb_typeof(r.fields->${key}->0) = 'object'
                             THEN r.fields->${key}->0->>'value'
                             ELSE r.fields->${key}->>0 END
      WHEN 'object' THEN r.fields->${key}->>'value'
      ELSE r.fields->>${key}
    END), '')`;
}

function normalizedSql(expr: ReturnType<typeof sql>) {
  return sql`lower(regexp_replace(btrim(${expr}), '\\s+', ' ', 'g'))`;
}

/**
 * The dominant `smf:notes` / `raw` population ("Legacy Notes") is immutable
 * after its initial successful import: once such a row carries a completed
 * (non-stub, fingerprint-stamped, current-logic-version) `s1_log_note`
 * mapping, ordinary runs exclude it AT THE QUERY BOUNDARY — its JSON payload
 * is never fetched, classified, resolved, hashed, verified, updated, or
 * deleted again. Unmapped or failed initial imports (fingerprint still NULL)
 * stay eligible for retry, and `--force-reconcile` disables the exclusion
 * entirely (operator escape hatch, e.g. after a transform correction).
 */
const IMMUTABLE_PREDICATE_SQL = sql`(
  ${normalizedSql(sql`COALESCE(${stagedFieldTextSql("field_sirius_log_category")}, ${stagedFieldTextSql("field_sirius_category")})`)} = 'smf:notes'
  AND ${normalizedSql(sql`COALESCE(${stagedFieldTextSql("field_sirius_log_type")}, ${stagedFieldTextSql("field_sirius_type")})`)} = 'raw'
)`;

const COMPLETED_MAPPING_SQL = sql`EXISTS (
  SELECT 1 FROM s1_staging.id_map m
   WHERE m.entity = ${ID_MAP_ENTITY} AND m.s1_id = r.nid
     AND m.stub = false AND m.consumed_fingerprint IS NOT NULL
     AND m.logic_version = ${LOGIC_VERSION}
)`;

async function immutableSkippedCount(): Promise<number> {
  if (FORCE_RECONCILE) return 0;
  const result = await db.execute(sql`
    SELECT count(*)::integer AS count
      FROM s1_staging.records r
     WHERE r.bundle = 'sirius_log' AND ${IMMUTABLE_PREDICATE_SQL} AND ${COMPLETED_MAPPING_SQL}
  `);
  return Number((result as unknown as { rows: Array<{ count: number | string }> }).rows[0]?.count ?? 0);
}

async function* pagedStagedLogs(): AsyncGenerator<StagedLog[]> {
  const exclusion = FORCE_RECONCILE
    ? sql``
    : sql` AND NOT (${IMMUTABLE_PREDICATE_SQL} AND ${COMPLETED_MAPPING_SQL})`;
  let lastNid = -1;
  for (;;) {
    const result = await db.execute(sql`
      SELECT r.nid, r.title, r.uid, r.created, r.fields, r.content_hash
        FROM s1_staging.records r
       WHERE r.bundle = 'sirius_log' AND r.nid > ${lastNid}${exclusion}
       ORDER BY r.nid LIMIT ${LOADER_PAGE_SIZE}
    `);
    const rows = (result as unknown as { rows: RawLog[] }).rows.map((row) => ({
      nid: Number(row.nid),
      title: row.title ?? null,
      uid: row.uid == null ? null : Number(row.uid),
      created: row.created == null ? null : Number(row.created),
      fields: (typeof row.fields === "string" ? JSON.parse(row.fields) : row.fields ?? {}) as Record<string, unknown>,
      contentHash: row.content_hash ?? null,
    }));
    if (rows.length === 0) return;
    lastNid = rows[rows.length - 1].nid;
    yield rows;
    if (rows.length < LOADER_PAGE_SIZE) return;
  }
}

async function stagedLogCount(): Promise<number> {
  const result = await db.execute(sql`
    SELECT count(*)::integer AS count
      FROM s1_staging.records
     WHERE bundle = 'sirius_log'
  `);
  const row = (result as unknown as { rows: Array<{ count: number | string }> }).rows[0];
  return Number(row?.count ?? 0);
}

interface Resolution {
  workerId: string | null;
  contactId: string | null;
  sourceKind: "worker" | "contact" | "unresolved";
  sourceId: number | null;
  outcome: string;
  candidateWorkerIds?: string[];
}

async function loadCreatorContext(): Promise<Map<number, S1LogCreator>> {
  const mappings = await getAllMappings("user");
  const mappedUserIds = [...new Set([...mappings.values()]
    .filter((mapping) => !mapping.stub)
    .map((mapping) => mapping.s2Id))];
  const existingUserIds = new Set<string>();
  if (mappedUserIds.length > 0) {
    const users = await db.execute(sql`
      SELECT id
        FROM users
       WHERE id IN (${sql.join(mappedUserIds.map((id) => sql`${id}`), sql`, `)})
    `);
    for (const row of (users as unknown as { rows: Array<{ id: string }> }).rows) {
      existingUserIds.add(row.id);
    }
  }
  const result = await db.execute(sql`
    SELECT uid, name
      FROM s1_staging.raw_users
     ORDER BY uid
  `);
  const displayNames = new Map<number, string | null>();
  for (const row of (result as unknown as { rows: Array<{ uid: string | number; name: string | null }> }).rows) {
    displayNames.set(Number(row.uid), row.name?.trim() || null);
  }
  return new Map([...new Set([...mappings.keys(), ...displayNames.keys()])].map((uid) => {
    const mapping = mappings.get(uid);
    return [uid, {
      ...resolveS1LogCreator({
        s1Uid: uid,
        mappedS2UserId: mapping && !mapping.stub && existingUserIds.has(mapping.s2Id) ? mapping.s2Id : null,
        displayName: displayNames.get(uid) ?? null,
      }),
    }];
  }));
}

async function resolveHandlers(handlerNids: number[]): Promise<Map<number, Resolution>> {
  const result = new Map<number, Resolution>();
  const unique = [...new Set(handlerNids)];
  const workerMaps = await getMappings("worker", unique);
  const contactMaps = await getMappings("contact", unique);
  const workerIds = [...new Set([...workerMaps.values()].map((m) => m.s2Id))];
  const contactIds = [...new Set([...contactMaps.values()].map((m) => m.s2Id))];
  const directWorkers = workerIds.length === 0 ? [] : (await db.execute(sql`
    SELECT id, contact_id AS "contactId" FROM workers WHERE id IN (${sql.join(workerIds.map((id) => sql`${id}`), sql`, `)})
  `) as unknown as { rows: Array<{ id: string; contactId: string | null }> }).rows;
  const byWorkerId = new Map(directWorkers.map((row) => [row.id, row]));
  const contactWorkers = contactIds.length === 0 ? [] : (await db.execute(sql`
    SELECT id, contact_id AS "contactId" FROM workers WHERE contact_id IN (${sql.join(contactIds.map((id) => sql`${id}`), sql`, `)})
    ORDER BY id
  `) as unknown as { rows: Array<{ id: string; contactId: string | null }> }).rows;
  const byContactId = new Map<string, Array<{ id: string; contactId: string | null }>>();
  for (const row of contactWorkers) {
    if (row.contactId) (byContactId.get(row.contactId) ?? (byContactId.set(row.contactId, []), byContactId.get(row.contactId)!)).push(row);
  }
  for (const nid of unique) {
    const workerMap = workerMaps.get(nid);
    const direct = workerMap ? byWorkerId.get(workerMap.s2Id) : undefined;
    if (direct) {
      result.set(nid, { workerId: direct.id, contactId: direct.contactId, sourceKind: "worker", sourceId: nid, outcome: `worker:${direct.id}` });
      continue;
    }
    const contactMap = contactMaps.get(nid);
    const candidates = contactMap ? byContactId.get(contactMap.s2Id) ?? [] : [];
    if (candidates.length === 1) {
      result.set(nid, { workerId: candidates[0].id, contactId: contactMap!.s2Id, sourceKind: "contact", sourceId: nid, outcome: `contact:${contactMap!.s2Id}:worker:${candidates[0].id}` });
    } else if (candidates.length > 1) {
      result.set(nid, { workerId: null, contactId: contactMap!.s2Id, sourceKind: "unresolved", sourceId: nid, outcome: `ambiguous-contact:${contactMap!.s2Id}`, candidateWorkerIds: candidates.map((candidate) => candidate.id) });
    } else {
      result.set(nid, { workerId: null, contactId: contactMap?.s2Id ?? null, sourceKind: "unresolved", sourceId: nid, outcome: contactMap ? `contact-unresolved:${contactMap.s2Id}` : "unresolved" });
    }
  }
  return result;
}

function sourceValue(fields: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = strOf(fields, key);
    if (value != null) return value;
  }
  return null;
}

function rawSourceValue(fields: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const raw = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
    const value = raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
      ? (raw as Record<string, unknown>).value
      : raw;
    if (value == null) continue;
    const text = String(value);
    if (text.length > 0) return text;
  }
  return null;
}

function noteText(row: StagedLog, creator: S1LogCreator): { subject: string; body: string | null } {
  const { body } = extractS1LogNoteBody(row.fields, row.title);
  return {
    subject: deriveS1LogNoteSubject(creator),
    body,
  };
}

function tagIdsFor(classification: LogNoteClassification, tagIds: Map<string, string>): string[] {
  const ids: string[] = [];
  if (classification.medium) {
    const id = tagIds.get(`medium:${classification.medium.toLowerCase()}`);
    if (id) ids.push(id);
  }
  for (const issue of classification.issues) {
    const sourceId = ISSUE_TAG_ID_BY_NAME[issue];
    const id = sourceId ? tagIds.get(sourceId) : undefined;
    if (id) ids.push(id);
  }
  return ids;
}

async function main() {
  const startedAt = new Date();
  await ensureStagingSchema();
  await ensureIdMap();
  await ensureRawUserTables();
  void storage;
  if (MIGRATION_MODE) console.error("MIGRATION MODE: charge-plugin execution is suppressed for all writes in this run.");
  throttleStorageOpLogs();
  const options = await ensureNoteOptions();
  const stagedTotal = await stagedLogCount();
  const immutableSkipped = await immutableSkippedCount();
  const progress = makeProgressLogger(LOADER, stagedTotal - immutableSkipped, { verb: "scanned" });
  const rejects = new RejectLog();
  const summary = emptySummary();
  const report: Record<string, unknown> = {};
  const inScopeNids = new Set<number>();
  const pendingAdvance: Array<{ s1Id: number; fingerprint: string }> = [];
  const resolutionCounts: Record<string, number> = {};
  const classificationCounts: Record<string, number> = {};
  let stagedFetched = 0;
  let inScope = 0;
  let orphaned = 0;
  let fastPathSkips = 0;
  let pages = 0;
  let bulkWriteChunks = 0;
  let verifyChunks = 0;
  let verifyFailures = 0;
  const creators = await loadCreatorContext();

  const BULK_WRITE_CHUNK = 400;
  const verifyPage = async (
    targets: Array<{ nid: number; s2Id: string; workerId: string; fingerprint: string }>,
  ): Promise<void> => {
    for (const batch of chunk(targets, 500)) {
      verifyChunks++;
      progress.phase("verify", batch.length, { cumulative: true });
      const values = batch.map((t) => sql`(${t.nid}::bigint, ${t.s2Id}, ${t.workerId})`);
      const result = await db.execute(sql`
        SELECT v.nid FROM (VALUES ${sql.join(values, sql`, `)}) AS v(nid, note_id, worker_id)
          JOIN entity_notes n ON n.id = v.note_id
         WHERE n.context_id = 'worker' AND n.entity_id = v.worker_id
           AND n.data->>'s1Loader' = ${LOADER}
      `);
      const verified = new Set(
        (result as unknown as { rows: Array<{ nid: string | number }> }).rows.map((r) => Number(r.nid)),
      );
      for (const t of batch) {
        if (rejects.hasAnyIn(t.nid, FATAL_REASONS)) continue;
        if (verified.has(t.nid)) {
          pendingAdvance.push({ s1Id: t.nid, fingerprint: t.fingerprint });
        } else {
          verifyFailures++;
          rejects.add("update_failed", { reason: "verify_failed" }, t.nid);
        }
      }
      progress.add(batch.length);
      progress.phase(null);
    }
  };

  for await (const page of pagedStagedLogs()) {
    pages++;
    stagedFetched += page.length;
    const scoped = page.map((row) => ({ row, classification: classifyS1Log(
      sourceValue(row.fields, "field_sirius_log_category", "field_sirius_category"),
      sourceValue(row.fields, "field_sirius_log_type", "field_sirius_type"),
    ) })).filter((item): item is { row: StagedLog; classification: LogNoteClassification } => item.classification !== null);
    const allHandlers = scoped.flatMap(({ row }) => targetNidsOf(row.fields, "field_sirius_log_handler"));
    const resolutions = await resolveHandlers(allHandlers);
    const classificationRows = scoped.map(({ row, classification }) => {
      const handlerNids = targetNidsOf(row.fields, "field_sirius_log_handler");
      const resolved = handlerNids.map((nid) => resolutions.get(nid)).filter((value): value is Resolution => Boolean(value?.workerId));
      const distinctWorkerIds = [...new Set(resolved.map((value) => value.workerId!))];
      const selected = distinctWorkerIds.length === 1 ? resolved.find((value) => value.workerId === distinctWorkerIds[0]) : undefined;
      const resolution = selected ?? {
        workerId: null,
        contactId: resolved[0]?.contactId ?? null,
        sourceKind: "unresolved" as const,
        sourceId: handlerNids[0] ?? null,
        outcome: handlerNids.length === 0 ? "handler-missing" : distinctWorkerIds.length > 1 ? "handler-ambiguous" : "handler-unresolved",
        candidateWorkerIds: distinctWorkerIds.length > 1 ? distinctWorkerIds : undefined,
      };
      const creator: S1LogCreator = row.uid == null
        ? resolveS1LogCreator({ s1Uid: null })
        : creators.get(row.uid) ?? resolveS1LogCreator({ s1Uid: row.uid });
      const fingerprint = combineFingerprints([
        ["source", row.contentHash],
        ["classification", contentHashOf(classification)],
        ["resolution", contentHashOf({ handlerNids, resolution })],
        ["creator", contentHashOf(creator)],
      ]);
      return { row, classification, handlerNids, resolution, creator, fingerprint };
    });
    // ONE mapping lookup per page (covers orphan cleanup AND disposition).
    const pageMappings = await getMappings(ID_MAP_ENTITY, classificationRows.map((item) => item.row.nid));
    type WriteItem = (typeof classificationRows)[number] & { existing: MappingInfo | undefined };
    const orphanDeletes: Array<{ nid: number; s2Id: string }> = [];
    const verifyTargets: Array<{ nid: number; s2Id: string; workerId: string; fingerprint: string }> = [];
    const writes: WriteItem[] = [];
    for (const item of classificationRows) {
      const { row, classification, resolution, fingerprint } = item;
      inScope++;
      inScopeNids.add(row.nid);
      const typeKey = `${classification.noteType}:${classification.medium ?? "none"}`;
      classificationCounts[typeKey] = (classificationCounts[typeKey] ?? 0) + 1;
      resolutionCounts[resolution.outcome] = (resolutionCounts[resolution.outcome] ?? 0) + 1;
      if (!resolution.workerId) {
        orphaned++;
        const existing = pageMappings.get(row.nid);
        if (existing) {
          if (DRY_RUN) summary.deleted++;
          else orphanDeletes.push({ nid: row.nid, s2Id: existing.s2Id });
        }
        continue;
      }
      if (row.created == null || !Number.isFinite(row.created)) {
        rejects.add("timestamp_missing", {}, row.nid);
        continue;
      }
      const existing = pageMappings.get(row.nid);
      const disposition = classifyRow(existing, fingerprint, LOGIC_VERSION, FORCE_RECONCILE);
      if (disposition === "unchanged") {
        fastPathSkips++;
        summary.unchanged++;
        verifyTargets.push({ nid: row.nid, s2Id: existing!.s2Id, workerId: resolution.workerId, fingerprint });
        continue;
      }
      if (DRY_RUN) {
        summary[disposition === "new" ? "created" : "updated"]++;
        continue;
      }
      writes.push({ ...item, existing });
    }

    // Batched orphan cleanup (ownership-guarded set-based delete + mapping removal).
    if (!DRY_RUN && orphanDeletes.length > 0) {
      const result = await loaderScope(() => storage.entityNotes.bulkDeleteForMigration(
        orphanDeletes.map((o) => o.s2Id), LOADER,
      ));
      summary.deleted += result.deleted;
      await deleteMappings(ID_MAP_ENTITY, orphanDeletes.map((o) => o.nid));
    }

    // Bounded bulk persistence: one transaction per chunk; a chunk-level
    // failure rejects every row in it (fingerprints never advanced → retryable).
    for (const writeChunk of chunk(writes, BULK_WRITE_CHUNK)) {
      bulkWriteChunks++;
      progress.phase("persist", writeChunk.length, { cumulative: true });
      const payload = writeChunk.map((item) => {
        const { row, classification, handlerNids, resolution, creator } = item;
        const text = noteText(row, creator);
        return {
          ref: row.nid,
          noteId: item.existing?.s2Id,
          note: {
            contextId: "worker",
            entityId: resolution.workerId!,
            typeId: options.noteTypeIds.get(classification.noteType)!,
            subject: text.subject,
            body: text.body,
            data: {
              s1Loader: LOADER,
              s1: {
                nid: row.nid,
                originalCategory: rawSourceValue(row.fields, "field_sirius_log_category", "field_sirius_category"),
                originalType: rawSourceValue(row.fields, "field_sirius_log_type", "field_sirius_type"),
                sourceTimestampEpoch: row.created,
                sourceTitle: row.title,
                normalizedCategory: classification.category,
                normalizedType: classification.type,
                handlerNids,
                creatorUid: creator.s1Uid,
                creatorDisplayName: creator.displayName,
              },
              resolution: {
                sourceKind: resolution.sourceKind,
                sourceId: resolution.sourceId,
                s1ContactId: resolution.sourceKind === "contact" ? resolution.sourceId : null,
                s1WorkerId: resolution.sourceKind === "worker" ? resolution.sourceId : null,
                candidateWorkerIds: resolution.candidateWorkerIds ?? [],
                contactId: resolution.contactId,
                workerId: resolution.workerId,
              },
            },
            timestamp: new Date(item.row.created! * 1000),
            userId: item.creator.s2UserId,
          },
          tagIds: tagIdsFor(classification, options.tagIds),
        };
      });
      try {
        const { saved, failed } = await loaderScope(() => storage.entityNotes.bulkReconcileForMigration({
          loader: LOADER,
          rows: payload,
        }));
        const newMappings: Array<{ s1Id: number; s2Id: string; fingerprint: string | null }> = [];
        for (const item of writeChunk) {
          const nid = item.row.nid;
          const failure = failed.get(nid);
          if (failure) {
            rejects.add(item.existing ? "update_failed" : "create_failed", { reason: failure }, nid);
            continue;
          }
          const result = saved.get(nid);
          if (!result) {
            rejects.add(item.existing ? "update_failed" : "create_failed", { reason: "not_saved" }, nid);
            continue;
          }
          if (item.existing) summary.updated++;
          else {
            // Fingerprint stays NULL until this row VERIFIES below — a failed
            // initial import (incl. immutable smf:notes rows) keeps its
            // mapping incomplete and stays eligible for retry.
            newMappings.push({ s1Id: nid, s2Id: result.noteId, fingerprint: null });
            summary.created++;
          }
          verifyTargets.push({ nid, s2Id: result.noteId, workerId: item.resolution.workerId!, fingerprint: item.fingerprint });
        }
        if (newMappings.length > 0) {
          await putMappings(ID_MAP_ENTITY, newMappings, { loader: LOADER, logicVersion: LOGIC_VERSION });
        }
      } catch {
        for (const item of writeChunk) {
          rejects.add(item.existing ? "update_failed" : "create_failed", { reason: "chunk_failed" }, item.row.nid);
        }
      }
      progress.add(writeChunk.length);
      progress.phase(null);
    }

    // Batch verification BEFORE fingerprints advance: existence, ownership,
    // and worker linkage checked set-based for every processed row.
    if (!DRY_RUN && verifyTargets.length > 0) await verifyPage(verifyTargets);
    progress.add(page.length);
  }

  if (!DRY_RUN) {
    await advanceFingerprints(
      ID_MAP_ENTITY,
      pendingAdvance.filter(({ s1Id }) => !rejects.hasAnyIn(s1Id, FATAL_REASONS)),
      LOGIC_VERSION,
    );
  }

  const sweep = await sweepDeletions({
    entity: ID_MAP_ENTITY,
    loaders: [LOADER],
    // Completed immutable rows are excluded at the page-query boundary, so
    // they never enter inScopeNids — the sourceSql leg marks every staged
    // immutable row as still-current so query exclusion is never mistaken
    // for source deletion (completed immutable mappings are permanently
    // retained). A row REALLY deleted from staging matches neither leg.
    sourceSql: sql`SELECT r.nid AS s1_id FROM s1_staging.records r WHERE r.bundle = 'sirius_log' AND ${IMMUTABLE_PREDICATE_SQL}`,
    sourceIds: inScopeNids,
    dryRun: DRY_RUN,
    policy: async (candidate: DeletionCandidate) => ({
      action: "delete",
      apply: async () => {
         await loaderScope(() => storage.entityNotes.deleteForMigration(candidate.s2Id, LOADER));
      },
    }),
  });
  summary.deleted += sweep.deleted;
  progress.stop();
  const elapsedSeconds = Math.max((Date.now() - startedAt.getTime()) / 1000, 0.001);
  report.stagedLogs = stagedFetched + immutableSkipped;
  report.stagedFetched = stagedFetched;
  report.immutableSkipped = immutableSkipped;
  report.inScope = inScope;
  report.orphaned = orphaned;
  report.fastPathSkips = fastPathSkips;
  report.batching = {
    pageSize: LOADER_PAGE_SIZE,
    pages,
    bulkWriteChunks,
    verifyChunks,
    bulkWritePath: !DRY_RUN,
  };
  report.performance = {
    elapsedSeconds: Math.round(elapsedSeconds * 10) / 10,
    stagedRowsPerSecond: Math.round(((stagedFetched + immutableSkipped) / elapsedSeconds) * 10) / 10,
    fetchedRowsPerSecond: Math.round((stagedFetched / elapsedSeconds) * 10) / 10,
    phases: {
      persist: progress.stats("persist"),
      verify: progress.stats("verify"),
    },
  };
  report.classificationCounts = classificationCounts;
  report.resolutionCounts = resolutionCounts;
  report.sweep = { candidates: sweep.candidates, deleted: sweep.deleted, alreadyHandled: sweep.alreadyHandled };
  const result = buildLoaderResult({
    loader: LOADER,
    logicVersion: LOGIC_VERSION,
    dryRun: DRY_RUN,
    forceReconcile: FORCE_RECONCILE,
    summary,
    rejects,
    allowedRejects: ALLOWED_REJECTS,
    verifyFailures,
    findings: sweep.findings,
    allowedFindings: ALLOWED_FINDINGS,
    detail: report,
  });
  emitLoaderResult(result);
  if (!DRY_RUN) await recordRun(startedAt, { loader: LOADER, forceReconcile: FORCE_RECONCILE }, result as unknown as Record<string, unknown>);
  process.exit(loaderExitCode(result));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "s1-log-notes failed");
  process.exit(1);
});