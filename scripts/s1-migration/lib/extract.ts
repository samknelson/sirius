/**
 * Generic, lossless S1 bundle extractor.
 *
 * Reassembles whole node records from `node` + every `field_data_*` table
 * declared for the bundle in field_config_instance (04-entity-reassembly
 * pattern), streaming in nid batches. Values are staged verbatim — no
 * transforms, no timezone handling here; that is load-time work.
 *
 * Field value shape in `fields` jsonb, keyed by field name:
 * - single data column, cardinality 1  -> scalar
 * - multi data columns, cardinality 1  -> object of { shortColumn: value }
 * - cardinality != 1                    -> array of the above, in delta order
 * - cardinality 1 but extra deltas seen -> array anyway + anomaly counted
 */
import type { Pool, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";
import type { FieldCatalog, S1FieldInstance } from "./s1";
import type { StagedRecord, StagedTerm } from "./staging";
import { makeProgressLogger, type ProgressLogger } from "./progress";

// The timer-backed heartbeat now lives in ./progress (shared with the
// loaders); re-exported so existing import sites (stage.ts) are unchanged.
export { makeProgressLogger, type ProgressLogger };

export interface ExtractAnomalies {
  /** rows with language != 'und' (trap: never assume, count instead) */
  nonUndLanguage: number;
  /** duplicate (entity_id, delta) rows — first wins, rest counted */
  duplicateDelta: number;
  /** cardinality-1 fields that produced >1 delta for some entity */
  extraDeltaOnSingle: number;
}

export interface BundleExtractReport {
  bundle: string;
  s1NodeCount: number;
  sourceCountAfter: number;
  extracted: number;
  /** Source identities scanned. Equals extracted for full extraction. */
  identitiesScanned: number;
  /** Full node+field payloads rebuilt. Smaller than identitiesScanned daily. */
  payloadExtracted: number;
  incremental: boolean;
  identityHash: string;
  timings: {
    identityReadMs: number;
    fieldReadMs: number;
    stagingCallbackMs: number;
  };
  shards?: Array<{
    index: number;
    afterNid: number;
    throughNid: number;
    identitiesScanned: number;
    payloadExtracted: number;
    durationMs: number;
    identityHash: string;
  }>;
  fieldRowCounts: Record<string, number>;
  anomalies: ExtractAnomalies;
  durationMs: number;
}

function emptyAnomalies(): ExtractAnomalies {
  return { nonUndLanguage: 0, duplicateDelta: 0, extraDeltaOnSingle: 0 };
}

function newIdentityHasher() {
  return createHash("sha256");
}

function updateIdentityHash(hasher: ReturnType<typeof newIdentityHasher>, nid: number): void {
  hasher.update(String(nid));
  hasher.update("\n");
}

function aggregateShardIdentityHash(
  shards: Array<{ index: number; afterNid: number; throughNid: number; identitiesScanned: number; identityHash: string }>,
): string {
  const hasher = newIdentityHasher();
  for (const shard of [...shards].sort((a, b) => a.index - b.index)) {
    hasher.update(`${shard.index}:${shard.afterNid}:${shard.throughNid}:${shard.identitiesScanned}:${shard.identityHash}\n`);
  }
  return hasher.digest("hex");
}

function rowPayload(field: S1FieldInstance, row: RowDataPacket): unknown {
  if (field.dataColumns.length === 1) return row[field.dataColumns[0]];
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < field.dataColumns.length; i++) {
    obj[field.shortColumns[i]] = row[field.dataColumns[i]];
  }
  return obj;
}

async function mergeFieldsForBatch(
  pool: Pool,
  entityType: string,
  bundle: string,
  fields: S1FieldInstance[],
  entityIds: number[],
  byEntity: Map<number, Record<string, unknown>>,
  fieldRowCounts: Record<string, number>,
  anomalies: ExtractAnomalies,
): Promise<void> {
  for (const field of fields) {
    // Deterministic order: on duplicate (entity_id, delta) rows — language
    // variants — 'und' wins first, then language, then revision_id, so
    // repeated runs always stage the same payload.
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT * FROM \`${field.tableName}\`
        WHERE entity_type = ? AND bundle = ? AND deleted = 0 AND entity_id IN (?)
        ORDER BY entity_id, delta, (language = 'und') DESC, language, revision_id`,
      [entityType, bundle, entityIds],
    );
    fieldRowCounts[field.fieldName] = (fieldRowCounts[field.fieldName] ?? 0) + rows.length;

    // Group by entity, dedupe (entity, delta), preserve delta order.
    const perEntity = new Map<number, { deltas: Set<number>; values: unknown[] }>();
    for (const row of rows) {
      const eid = Number(row.entity_id);
      const delta = Number(row.delta);
      if (String(row.language) !== "und") anomalies.nonUndLanguage++;
      let acc = perEntity.get(eid);
      if (!acc) {
        acc = { deltas: new Set(), values: [] };
        perEntity.set(eid, acc);
      }
      if (acc.deltas.has(delta)) {
        anomalies.duplicateDelta++;
        continue;
      }
      acc.deltas.add(delta);
      acc.values.push(rowPayload(field, row));
    }

    for (const [eid, acc] of perEntity) {
      const target = byEntity.get(eid);
      if (!target) continue; // field row for a node outside this batch window — impossible given IN(), defensive
      if (field.cardinality === 1) {
        if (acc.values.length > 1) {
          anomalies.extraDeltaOnSingle++;
          target[field.fieldName] = acc.values;
        } else {
          target[field.fieldName] = acc.values[0];
        }
      } else {
        target[field.fieldName] = acc.values;
      }
    }
  }
}

export async function extractBundle(
  pool: Pool,
  bundle: string,
  fields: S1FieldInstance[],
  batchSize: number,
  onBatch: (records: StagedRecord[]) => Promise<void>,
): Promise<BundleExtractReport> {
  const start = Date.now();
  const anomalies = emptyAnomalies();
  const fieldRowCounts: Record<string, number> = {};
  let identityReadMs = 0;
  let fieldReadMs = 0;
  let stagingCallbackMs = 0;
  const identityHasher = newIdentityHasher();

  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM node WHERE type = ?`,
    [bundle],
  );
  const s1NodeCount = Number(countRow?.n ?? 0);
  const progress = makeProgressLogger(bundle, s1NodeCount, { verb: "staged" });
  try {
  let cursor = 0;
  let extracted = 0;
  for (;;) {
    const identityStartedAt = Date.now();
    const [nodes] = await pool.query<RowDataPacket[]>(
      `SELECT nid, vid, title, uid, status, created, changed
         FROM node WHERE type = ? AND nid > ?
        ORDER BY nid LIMIT ?`,
      [bundle, cursor, batchSize],
    );
    identityReadMs += Date.now() - identityStartedAt;
    if (nodes.length === 0) break;
    cursor = Number(nodes[nodes.length - 1].nid);

    const byEntity = new Map<number, Record<string, unknown>>();
    const records: StagedRecord[] = nodes.map((n) => {
      const fieldsObj: Record<string, unknown> = {};
      byEntity.set(Number(n.nid), fieldsObj);
      return {
        bundle,
        nid: Number(n.nid),
        vid: n.vid == null ? null : Number(n.vid),
        title: n.title == null ? null : String(n.title),
        uid: n.uid == null ? null : Number(n.uid),
        status: n.status == null ? null : Number(n.status),
        created: n.created == null ? null : Number(n.created),
        changed: n.changed == null ? null : Number(n.changed),
        fields: fieldsObj,
      };
    });
    for (const record of records) updateIdentityHash(identityHasher, record.nid);

    if (fields.length > 0) {
      const fieldsStartedAt = Date.now();
      await mergeFieldsForBatch(
        pool,
        "node",
        bundle,
        fields,
        records.map((r) => r.nid),
        byEntity,
        fieldRowCounts,
        anomalies,
      );
      fieldReadMs += Date.now() - fieldsStartedAt;
    }

    const stagingStartedAt = Date.now();
    await onBatch(records);
    stagingCallbackMs += Date.now() - stagingStartedAt;
    extracted += records.length;
    progress.update(extracted);
  }

  return {
    bundle,
    s1NodeCount,
    sourceCountAfter: await nodeCount(pool, bundle),
    extracted,
    identitiesScanned: extracted,
    payloadExtracted: extracted,
    incremental: false,
    identityHash: identityHasher.digest("hex"),
    timings: { identityReadMs, fieldReadMs, stagingCallbackMs },
    fieldRowCounts,
    anomalies,
    durationMs: Date.now() - start,
  };
  } finally {
    progress.stop();
  }
}

export interface IncrementalBundleHooks {
  /**
   * Called once for every lightweight source-node batch. It must mark all
   * supplied identities seen in the staging generation, and returns exactly
   * the identities whose full field payload must be rebuilt.
   */
  selectPayloadIds: (nodes: StagedRecord[]) => Promise<Set<number>>;
  onPayload: (records: StagedRecord[]) => Promise<void>;
}

async function nodeCount(pool: Pool, bundle: string): Promise<number> {
  const [[row]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM node WHERE type = ?`,
    [bundle],
  );
  return Number(row?.n ?? 0);
}

/**
 * Daily node staging: scan every current S1 identity and scalar change marker,
 * but rebuild fields only for new/changed/conservatively-overlapped records.
 * The caller owns staging generation marking and cleanup so it can prove
 * missing identities before removing them.
 */
export async function extractBundleIncremental(
  pool: Pool,
  bundle: string,
  fields: S1FieldInstance[],
  batchSize: number,
  hooks: IncrementalBundleHooks,
  range?: { index: number; count: number; afterNid: number; throughNid: number },
): Promise<BundleExtractReport> {
  const start = Date.now();
  const s1NodeCount = await nodeCount(pool, bundle);
  const progress = makeProgressLogger(
    range ? `${bundle} shard ${range.index}/${range.count}` : bundle,
    s1NodeCount,
    { verb: "identity-scanned" },
  );
  const anomalies = emptyAnomalies();
  const fieldRowCounts: Record<string, number> = {};
  let cursor = range?.afterNid ?? 0;
  let identitiesScanned = 0;
  let payloadExtracted = 0;
  let identityReadMs = 0;
  let fieldReadMs = 0;
  let stagingCallbackMs = 0;
  const identityHasher = newIdentityHasher();

  try {
    for (;;) {
      const identityStartedAt = Date.now();
      const [nodes] = range
        ? await pool.query<RowDataPacket[]>(
            `SELECT nid, vid, title, uid, status, created, changed
               FROM node
              WHERE type = ? AND nid > ? AND nid <= ?
              ORDER BY nid LIMIT ?`,
            [bundle, cursor, range.throughNid, batchSize],
          )
        : await pool.query<RowDataPacket[]>(
            `SELECT nid, vid, title, uid, status, created, changed
               FROM node WHERE type = ? AND nid > ?
              ORDER BY nid LIMIT ?`,
            [bundle, cursor, batchSize],
          );
      identityReadMs += Date.now() - identityStartedAt;
      if (nodes.length === 0) break;
      cursor = Number(nodes[nodes.length - 1].nid);

      const records: StagedRecord[] = nodes.map((n) => ({
        bundle,
        nid: Number(n.nid),
        vid: n.vid == null ? null : Number(n.vid),
        title: n.title == null ? null : String(n.title),
        uid: n.uid == null ? null : Number(n.uid),
        status: n.status == null ? null : Number(n.status),
        created: n.created == null ? null : Number(n.created),
        changed: n.changed == null ? null : Number(n.changed),
        fields: {},
      }));
      for (const record of records) updateIdentityHash(identityHasher, record.nid);
      const stagingSelectStartedAt = Date.now();
      const payloadIds = await hooks.selectPayloadIds(records);
      stagingCallbackMs += Date.now() - stagingSelectStartedAt;
      const payloadRecords = records.filter((r) => payloadIds.has(r.nid));
      if (payloadRecords.length > 0 && fields.length > 0) {
        const byEntity = new Map<number, Record<string, unknown>>();
        for (const record of payloadRecords) byEntity.set(record.nid, record.fields);
        const fieldsStartedAt = Date.now();
        await mergeFieldsForBatch(
          pool,
          "node",
          bundle,
          fields,
          payloadRecords.map((r) => r.nid),
          byEntity,
          fieldRowCounts,
          anomalies,
        );
        fieldReadMs += Date.now() - fieldsStartedAt;
      }
      if (payloadRecords.length > 0) {
        const stagingWriteStartedAt = Date.now();
        await hooks.onPayload(payloadRecords);
        stagingCallbackMs += Date.now() - stagingWriteStartedAt;
      }
      identitiesScanned += records.length;
      payloadExtracted += payloadRecords.length;
      progress.update(identitiesScanned);
    }
  } finally {
    progress.stop();
  }

  return {
    bundle,
    s1NodeCount,
    sourceCountAfter: await nodeCount(pool, bundle),
    extracted: identitiesScanned,
    identitiesScanned,
    payloadExtracted,
    incremental: true,
    identityHash: identityHasher.digest("hex"),
    timings: { identityReadMs, fieldReadMs, stagingCallbackMs },
    shards: range
      ? [{
          index: range.index,
          afterNid: range.afterNid,
          throughNid: range.throughNid,
          identitiesScanned,
          payloadExtracted,
          durationMs: Date.now() - start,
          identityHash: "",
        }]
      : undefined,
    fieldRowCounts,
    anomalies,
    durationMs: Date.now() - start,
  };
}

/**
 * Bounded within-bundle parallelism for the dominant daily bundles. Numeric
 * NID ranges are disjoint; all workers settle before the caller may reconcile
 * stale staging rows. A failed shard therefore cannot trigger partial cleanup.
 */
export async function extractBundleIncrementalSharded(
  pool: Pool,
  bundle: string,
  fields: S1FieldInstance[],
  batchSize: number,
  hooks: IncrementalBundleHooks,
  shardCount: number,
): Promise<BundleExtractReport> {
  const start = Date.now();
  const [[bounds]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n, MIN(nid) AS min_nid, MAX(nid) AS max_nid
       FROM node WHERE type = ?`,
    [bundle],
  );
  const sourceCountBefore = Number(bounds?.n ?? 0);
  const minNid = bounds?.min_nid == null ? null : Number(bounds.min_nid);
  const maxNid = bounds?.max_nid == null ? null : Number(bounds.max_nid);
  if (sourceCountBefore === 0 || minNid == null || maxNid == null || shardCount <= 1) {
    return extractBundleIncremental(pool, bundle, fields, batchSize, hooks);
  }

  const count = Math.max(1, Math.min(Math.floor(shardCount), sourceCountBefore));
  const width = Math.max(1, Math.ceil((maxNid - minNid + 1) / count));
  const ranges = Array.from({ length: count }, (_, offset) => {
    const rangeMin = minNid + offset * width;
    const rangeMax = offset === count - 1 ? Number.MAX_SAFE_INTEGER : Math.min(maxNid, rangeMin + width - 1);
    return {
      index: offset + 1,
      count,
      // Drupal NIDs are positive. The first shard must cover below the
      // observed minimum as well: an older node can enter this bundle through
      // a live type correction while staging is running.
      afterNid: offset === 0 ? 0 : rangeMin - 1,
      throughNid: rangeMax,
    };
  }).filter((range) => range.afterNid < range.throughNid);

  const settled = await Promise.allSettled(
    ranges.map((range) => extractBundleIncremental(pool, bundle, fields, batchSize, hooks, range)),
  );
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    const messages = failures.map((failure) =>
      failure.reason instanceof Error ? failure.reason.message.split("\n")[0] : String(failure.reason),
    );
    throw new Error(`${bundle}: ${failures.length}/${ranges.length} staging shard(s) failed: ${messages.join("; ")}`);
  }
  const reports = settled
    .filter((result): result is PromiseFulfilledResult<BundleExtractReport> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => (a.shards?.[0]?.index ?? 0) - (b.shards?.[0]?.index ?? 0));
  for (const report of reports) {
    if (report.shards?.[0]) report.shards[0].identityHash = report.identityHash;
  }
  const fieldRowCounts: Record<string, number> = {};
  for (const report of reports) {
    for (const [field, rows] of Object.entries(report.fieldRowCounts)) {
      fieldRowCounts[field] = (fieldRowCounts[field] ?? 0) + rows;
    }
  }
  const sum = (pick: (report: BundleExtractReport) => number) => reports.reduce((total, report) => total + pick(report), 0);
  const shards = reports.flatMap((report) => report.shards ?? []);
  return {
    bundle,
    s1NodeCount: sourceCountBefore,
    sourceCountAfter: await nodeCount(pool, bundle),
    extracted: sum((report) => report.extracted),
    identitiesScanned: sum((report) => report.identitiesScanned),
    payloadExtracted: sum((report) => report.payloadExtracted),
    incremental: true,
    identityHash: aggregateShardIdentityHash(shards),
    timings: {
      identityReadMs: sum((report) => report.timings.identityReadMs),
      fieldReadMs: sum((report) => report.timings.fieldReadMs),
      stagingCallbackMs: sum((report) => report.timings.stagingCallbackMs),
    },
    shards,
    fieldRowCounts,
    anomalies: {
      nonUndLanguage: sum((report) => report.anomalies.nonUndLanguage),
      duplicateDelta: sum((report) => report.anomalies.duplicateDelta),
      extraDeltaOnSingle: sum((report) => report.anomalies.extraDeltaOnSingle),
    },
    durationMs: Date.now() - start,
  };
}

export interface BundleIdentityVerification {
  identitiesScanned: number;
  sourceCountAfter: number;
  identityHash: string;
  shards: Array<{
    index: number;
    afterNid: number;
    throughNid: number;
    identitiesScanned: number;
    identityHash: string;
  }>;
}

/**
 * Re-scan only source NIDs and fingerprint the exact ordered identity workset.
 * Daily cleanup is allowed only when this verification fingerprint matches
 * the extraction fingerprint. This detects inserts/deletes at shard bounds
 * and equal-count churn that before/after COUNT queries cannot prove.
 */
export async function verifyBundleIdentityWorkset(
  pool: Pool,
  bundle: string,
  batchSize: number,
  extractionShards?: BundleExtractReport["shards"],
): Promise<BundleIdentityVerification> {
  const ranges =
    extractionShards && extractionShards.length > 0
      ? extractionShards.map(({ index, afterNid, throughNid }) => ({ index, afterNid, throughNid }))
      : [{ index: 1, afterNid: 0, throughNid: Number.MAX_SAFE_INTEGER }];
  const settled = await Promise.allSettled(
    ranges.map(async (range) => {
      const hasher = newIdentityHasher();
      let cursor = range.afterNid;
      let identitiesScanned = 0;
      for (;;) {
        const [rows] = await pool.query<RowDataPacket[]>(
          `SELECT nid
             FROM node
            WHERE type = ? AND nid > ? AND nid <= ?
            ORDER BY nid LIMIT ?`,
          [bundle, cursor, range.throughNid, batchSize],
        );
        if (rows.length === 0) break;
        for (const row of rows) updateIdentityHash(hasher, Number(row.nid));
        identitiesScanned += rows.length;
        cursor = Number(rows[rows.length - 1].nid);
      }
      return { ...range, identitiesScanned, identityHash: hasher.digest("hex") };
    }),
  );
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length > 0) {
    throw new Error(`${bundle}: identity verification failed for ${failures.length}/${ranges.length} shard(s)`);
  }
  const shards = settled
    .filter((result): result is PromiseFulfilledResult<BundleIdentityVerification["shards"][number]> => result.status === "fulfilled")
    .map((result) => result.value)
    .sort((a, b) => a.index - b.index);
  return {
    identitiesScanned: shards.reduce((total, shard) => total + shard.identitiesScanned, 0),
    sourceCountAfter: await nodeCount(pool, bundle),
    identityHash: extractionShards && extractionShards.length > 0
      ? aggregateShardIdentityHash(shards)
      : shards[0]?.identityHash ?? newIdentityHasher().digest("hex"),
    shards,
  };
}

export interface TermExtractReport {
  s1TermCount: number;
  sourceCountAfter: number;
  extracted: number;
  vocabularies: Record<string, number>;
  anomalies: ExtractAnomalies;
  durationMs: number;
}

export async function extractTerms(
  pool: Pool,
  termCatalog: FieldCatalog,
  batchSize: number,
  onBatch: (terms: StagedTerm[]) => Promise<void>,
): Promise<TermExtractReport> {
  const start = Date.now();
  const anomalies = emptyAnomalies();
  const vocabularies: Record<string, number> = {};

  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM taxonomy_term_data`,
  );
  const s1TermCount = Number(countRow?.n ?? 0);
  const progress = makeProgressLogger("terms", s1TermCount, { verb: "staged" });
  try {

  // vocabulary machine names, and per-vocabulary field instances
  const [vocabs] = await pool.query<RowDataPacket[]>(
    `SELECT vid, machine_name FROM taxonomy_vocabulary`,
  );
  const vocabByVid = new Map<number, string>(
    vocabs.map((v) => [Number(v.vid), String(v.machine_name)]),
  );
  const fieldsByVocab = termCatalog;

  let cursor = 0;
  let extracted = 0;
  for (;;) {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT tid, vid, name, description, weight
         FROM taxonomy_term_data WHERE tid > ? ORDER BY tid LIMIT ?`,
      [cursor, batchSize],
    );
    if (rows.length === 0) break;
    cursor = Number(rows[rows.length - 1].tid);

    const terms: StagedTerm[] = [];
    const byVocab = new Map<string, { byEntity: Map<number, Record<string, unknown>>; ids: number[] }>();
    for (const r of rows) {
      const vocabulary = vocabByVid.get(Number(r.vid)) ?? `vid:${r.vid}`;
      const fieldsObj: Record<string, unknown> = {};
      terms.push({
        tid: Number(r.tid),
        vocabulary,
        name: String(r.name),
        description: r.description == null ? null : String(r.description),
        weight: Number(r.weight ?? 0),
        fields: fieldsObj,
      });
      let acc = byVocab.get(vocabulary);
      if (!acc) {
        acc = { byEntity: new Map(), ids: [] };
        byVocab.set(vocabulary, acc);
      }
      acc.byEntity.set(Number(r.tid), fieldsObj);
      acc.ids.push(Number(r.tid));
    }

    for (const [vocabulary, acc] of byVocab) {
      const vFields = fieldsByVocab.get(vocabulary) ?? [];
      if (vFields.length === 0) continue;
      vocabularies[vocabulary] = (vocabularies[vocabulary] ?? 0) + acc.ids.length;
      await mergeFieldsForBatch(
        pool,
        "taxonomy_term",
        vocabulary,
        vFields,
        acc.ids,
        acc.byEntity,
        {},
        anomalies,
      );
    }
    for (const t of terms) {
      vocabularies[t.vocabulary] = vocabularies[t.vocabulary] ?? 0;
    }

    await onBatch(terms);
    extracted += terms.length;
    progress.update(extracted);
  }

  // recount per vocabulary accurately (cheap)
  const [perVocab] = await pool.query<RowDataPacket[]>(
    `SELECT v.machine_name AS name, COUNT(*) AS n
       FROM taxonomy_term_data t JOIN taxonomy_vocabulary v ON v.vid = t.vid
      GROUP BY v.machine_name`,
  );
  for (const r of perVocab) vocabularies[String(r.name)] = Number(r.n);

  const [[afterRow]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM taxonomy_term_data`);
  return {
    s1TermCount,
    sourceCountAfter: Number(afterRow?.n ?? 0),
    extracted,
    vocabularies,
    anomalies,
    durationMs: Date.now() - start,
  };
  } finally {
    progress.stop();
  }
}
