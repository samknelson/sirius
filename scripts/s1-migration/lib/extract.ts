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
import type { FieldCatalog, S1FieldInstance } from "./s1";
import type { StagedRecord, StagedTerm } from "./staging";

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
  extracted: number;
  fieldRowCounts: Record<string, number>;
  anomalies: ExtractAnomalies;
  durationMs: number;
}

function emptyAnomalies(): ExtractAnomalies {
  return { nonUndLanguage: 0, duplicateDelta: 0, extraDeltaOnSingle: 0 };
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

  const [[countRow]] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM node WHERE type = ?`,
    [bundle],
  );
  const s1NodeCount = Number(countRow?.n ?? 0);

  let cursor = 0;
  let extracted = 0;
  for (;;) {
    const [nodes] = await pool.query<RowDataPacket[]>(
      `SELECT nid, vid, title, uid, status, created, changed
         FROM node WHERE type = ? AND nid > ?
        ORDER BY nid LIMIT ?`,
      [bundle, cursor, batchSize],
    );
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

    if (fields.length > 0) {
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
    }

    await onBatch(records);
    extracted += records.length;
  }

  return {
    bundle,
    s1NodeCount,
    extracted,
    fieldRowCounts,
    anomalies,
    durationMs: Date.now() - start,
  };
}

export interface TermExtractReport {
  s1TermCount: number;
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
  }

  // recount per vocabulary accurately (cheap)
  const [perVocab] = await pool.query<RowDataPacket[]>(
    `SELECT v.machine_name AS name, COUNT(*) AS n
       FROM taxonomy_term_data t JOIN taxonomy_vocabulary v ON v.vid = t.vid
      GROUP BY v.machine_name`,
  );
  for (const r of perVocab) vocabularies[String(r.name)] = Number(r.n);

  return { s1TermCount, extracted, vocabularies, anomalies, durationMs: Date.now() - start };
}
