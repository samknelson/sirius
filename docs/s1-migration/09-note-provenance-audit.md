# 09 — Imported-note provenance audit kit (rehearsal target)

Purpose: after a real `s1-log-notes` sync against the rehearsal database,
confirm that (a) imported note bodies agree with the staged source records —
including long and multi-value notes — without exposing note content, (b)
creator provenance is correct (mapped creators populate `notes.user_id`;
unmapped creators retain UID/display-name provenance), (c) rerunning the same
staged data updates in place with **no duplicate `s1_log_note` mappings**, and
(d) any source-shape variants needing a transform ruling are surfaced.

**Execution model (ruling, 2026-08-18):** the workspace has no access to the
rehearsal database (HIPAA boundary — it lives in-VPC; DSN only in AWS Secrets
Manager). All target-database steps are **operator-run**: SQL is pasted into
the Neon SQL editor connected to the rehearsal DB
(`migration-rehearsal-2026-08-06`), loader runs execute as ECS one-off tasks
per the RUNBOOK/FC conventions, and S1-side confirmations run in the
CloudShell **VPC tab**. Aggregate outputs are pasted back for triage.

**Sanitization bar (unchanged):** this file and everything committed carry
aggregate counts and reason codes only — no production nids, no note content,
no names, no hostnames. Queries below never SELECT note bodies or subjects;
content comparison is by `md5`/length only. Query outputs that carry raw nids
(marked ⚠) are for chat paste-back only; never commit them.

Every N-series query was validated **verbatim** against the dev database
(2026-08-27, zero failures, gates all green on the dev fixture load); the
M-series ran verbatim against the dev S1 MariaDB the same day. All queries
are read-only except the explicitly-marked OP-1b adoption statement.

---

## 1. Known abort condition found while building this kit

**Component-seeded option rows collide with the loader's S1 identities.** The
notes/BAO components seed rows named `Member Inbound`, `Member Outreach`,
`Provider Communication`, `Document Detail` (note types) and `Medium`,
`Issue`, `Resolution` (tag types) **without** an S1 source identity. The
loader deliberately refuses to guess and ABORTs:

```
ABORTING: note type "Member Inbound" exists without the S1 source identity
```

The rehearsal target was provisioned with component seeds, so expect this
abort on the first run there. A same-name row is **not automatically** the
component seed — a staff member could have created an option with that name.
So adoption is inspect-and-confirm, never blanket: the OP-1 preflight (N1)
returns the full candidate rows (id, description, data payload, usage count)
for paste-back; the operator confirms in chat which rows are the component
seeds; only then is the OP-1b adoption applied, **pinned to the confirmed
row ids**. Existing notes keep their type; the loader then adopts and
maintains the stamped rows idempotently. This flow was exercised on dev:
inspect → confirm → adopt → loader run → idempotent rerun, all green.

---

## 2. Operator procedure (run in this order)

**OP-0 — prerequisites.** The ECS one-off image must be built from a bao-dev
revision that includes the current `scripts/s1-migration/load-log-notes.ts`
(full-text preservation + creator resolution + reconcile; `LOGIC_VERSION 3`).
Contacts/workers and users loaders must already have run on the target
(RUNBOOK §4 order), and staging must hold `bundle = 'sirius_log'` records and
`s1_staging.raw_users`.

**OP-1 — preflight.** Run **N0** and **N1** in the Neon SQL editor. N0's `db`
must be the rehearsal database with production-scale `staged_logs` (dev shows
tens). If **N1** returns rows, **paste the full N1 output back to chat and
stop** — each candidate row is inspected there (a component seed shows a
plain-UUID id, the generic seeded description/data payload, and no
staff-authored customization; anything else is treated as staff-created and
gets a per-row ruling instead of adoption). Proceed to OP-1b only for the
rows explicitly confirmed in chat. Zero N1 rows → skip OP-1b.

**OP-1b — identity adoption (only for chat-confirmed rows; the one write in
this kit).** Fill in the confirmed row id per statement — the WHERE is pinned
to the exact id AND the expected name AND the still-identity-less state, so a
wrong paste is a 0-row no-op. One statement per confirmed note type (pick the
matching `(sid, ord)` pair: C/10 Comment, L/20 Legacy Notes, I/30 Member
Inbound, O/40 Member Outreach, P/50 Provider Communication, D/60 Document
Detail):

```sql
BEGIN;
UPDATE options_note_type SET
  sirius_id = 'I',
  data = COALESCE(data,'{}'::jsonb)
         || jsonb_build_object('s1SourceId', 's1-log-note:type:I', 'order', 30)
         || jsonb_build_object('entityTypes',
              (SELECT jsonb_agg(DISTINCT e) FROM (
                 SELECT jsonb_array_elements_text(COALESCE(data->'entityTypes','[]'::jsonb)) AS e
                 UNION SELECT 'worker') s))
WHERE id = '<confirmed-row-id>'
  AND name = 'Member Inbound'
  AND COALESCE(sirius_id,'') = ''
  AND COALESCE(data->>'s1SourceId','') = '';
COMMIT;
```

and per confirmed tag type (tid: medium / issue / resolution):

```sql
BEGIN;
UPDATE options_sitespecific_bao_notes_tag_types SET
  data = COALESCE(data,'{}'::jsonb) || jsonb_build_object('s1SourceId','s1-log-notes:tag-type:medium')
WHERE id = '<confirmed-row-id>'
  AND name = 'Medium'
  AND COALESCE(data->>'s1SourceId','') = '';
COMMIT;
```

Every statement must report `UPDATE 1`; anything else means the row moved —
re-run N1 and re-confirm. Re-run N1 after all adoptions — it must return zero
rows. (Seeded *tags* colliding by name would still abort; N1's third arm
detects them. None existed on dev; if the rehearsal shows some, paste back
for a ruling before inventing an adoption.)

**OP-2 — sync.** ECS one-off, per RUNBOOK §4 row 13:

```bash
npx tsx scripts/s1-migration/load-log-notes.ts --migration-mode
```

No reject allowance on the first run (RUNBOOK §5: `timestamp_missing` /
`create_failed` / `update_failed` are never blanket-allowed). Capture the
stdout JSON (aggregates only by design) and paste it back.

**OP-3 — rerun (idempotency proof).** Run the exact same command again.
Expected: `created = 0, updated = 0, deleted = 0`, and
`unchanged + detail.immutableSkipped` equal to the first run's
`created + updated + unchanged`, identical rejects, sweep 0.
`detail.immutableSkipped` counts completed `smf:notes` / `raw` ("Legacy
Notes") rows excluded at the staged-page query boundary — the loader never
re-reads, re-hashes, or re-verifies them on ordinary runs, so the dominant
population costs nothing on reruns. `unchanged` covers only the mutable
classifications that were actually fetched and fingerprint-checked.
Any `updated > 0` on an untouched staging snapshot is a fingerprint
instability — paste back. (`--force-reconcile` disables the immutable skip
and re-reconciles everything; expect `immutableSkipped = 0` on such runs.)

**OP-4 — target-DB query pack.** Run **N0–N8b** (§3) in the Neon SQL editor;
paste back all outputs. If N4 shows `body_mismatch > 0`, also run **N9** ⚠
(nids only — chat paste-back, never committed).

**OP-5 — S1-side confirmations.** In CloudShell (**VPC tab**), run **M1–M4**
(§4) and paste back.

Paste-back checklist: §6.

---

## 3. N-series — target Postgres (Neon SQL editor)

### N0 — sanity: confirm the target and gross counts

```sql
SELECT current_database() AS db,
  (SELECT count(*) FROM s1_staging.records WHERE bundle = 'sirius_log')            AS staged_logs,
  (SELECT count(*) FROM s1_staging.id_map WHERE entity = 's1_log_note')            AS id_mapped,
  (SELECT count(*) FROM notes WHERE data->>'s1Loader' = 's1-log-notes')            AS loaded_notes,
  (SELECT count(*) FROM s1_staging.raw_users)                                      AS staged_users,
  (SELECT count(*) FROM s1_staging.id_map WHERE entity = 'user' AND NOT stub)      AS mapped_users;
```

### N1 — preflight: seeded-name collisions that abort the loader ⚠ (full rows for chat inspection — paste back, never adopt unconfirmed)

Gate: zero rows (after chat-confirmed OP-1b adoptions if needed). Nonzero
rows are **candidates for inspection**, not automatic adoption targets — see
OP-1.

```sql
SELECT 'note_type' AS kind, o.id, o.name, o.description, o.data,
       (SELECT count(*) FROM notes n WHERE n.type_id = o.id) AS rows_in_use
  FROM options_note_type o
 WHERE o.name IN ('Comment','Legacy Notes','Member Inbound','Member Outreach','Provider Communication','Document Detail')
   AND COALESCE(o.data->>'s1SourceId','') = '' AND COALESCE(o.sirius_id,'') = ''
UNION ALL
SELECT 'tag_type', t.id, t.name, t.description, t.data,
       (SELECT count(*) FROM options_sitespecific_bao_notes_tags g WHERE g.tag_type_id = t.id)
  FROM options_sitespecific_bao_notes_tag_types t
 WHERE t.name IN ('Medium','Issue','Resolution')
   AND COALESCE(t.data->>'s1SourceId','') = ''
UNION ALL
SELECT 'tag', g.id, g.name, g.description, g.data,
       (SELECT count(*) FROM sitespecific_bao_notes_tags a WHERE a.tag_id = g.id)
  FROM options_sitespecific_bao_notes_tags g
 WHERE g.name IN ('Call','In-Person','Email','Letter','Enrollment','Disability','MLK','Employer','Life Insurance','ID Card','Kaiser','Dental','Appeal','Delta')
   AND COALESCE(g.data->>'s1SourceId','') = ''
 ORDER BY 1, 3;
```

### N2 — recorded runs (create run + idempotent rerun)

Gate: latest run `reject_gate = pass`, `verify = pass`; the rerun row shows
`created/updated/deleted = 0` with `unchanged + immutable_skipped` = the
create run's total (completed `smf:notes`/`raw` rows are query-excluded on
reruns and reported in `detail.immutableSkipped`, not `unchanged`).

```sql
SELECT id, started_at,
       report->'summary'               AS summary,
       report->'rejectGate'->>'status' AS reject_gate,
       report->'verify'->>'status'     AS verify,
       report->'detail'->>'stagedLogs' AS staged,
       report->'detail'->>'immutableSkipped' AS immutable_skipped,
       report->'detail'->>'inScope'    AS in_scope,
       report->'detail'->>'orphaned'   AS orphaned,
       report->'detail'->'classificationCounts' AS classification_counts
  FROM s1_staging.runs
 WHERE args->>'loader' = 's1-log-notes'
 ORDER BY id DESC
 LIMIT 6;
```

### N3 — mapping identity + duplicate gates

Gates: `id_mapped = loaded_notes`; **all four remaining columns = 0**.
`dup_note_targets` is the "no duplicate s1_log_note mappings" gate (two nids
mapped to one note); `(entity, s1_id)` is the id_map primary key, so the
nid-side cannot duplicate structurally.

```sql
SELECT
  (SELECT count(*) FROM s1_staging.id_map WHERE entity = 's1_log_note')             AS id_mapped,
  (SELECT count(*) FROM notes WHERE data->>'s1Loader' = 's1-log-notes')             AS loaded_notes,
  (SELECT count(*) FROM (SELECT s2_id FROM s1_staging.id_map
     WHERE entity = 's1_log_note' GROUP BY s2_id HAVING count(*) > 1) d)            AS dup_note_targets,
  (SELECT count(*) FROM s1_staging.id_map m
     WHERE m.entity = 's1_log_note'
       AND NOT EXISTS (SELECT 1 FROM notes n WHERE n.id = m.s2_id))                 AS mapped_but_missing,
  (SELECT count(*) FROM notes n
     WHERE n.data->>'s1Loader' = 's1-log-notes'
       AND NOT EXISTS (SELECT 1 FROM s1_staging.id_map m
                        WHERE m.entity = 's1_log_note' AND m.s2_id = n.id))         AS loaded_but_unmapped,
  (SELECT count(*) FROM notes n
     WHERE n.data->>'s1Loader' = 's1-log-notes'
       AND (n.data->'s1'->>'nid') !~ '^[0-9]+$')                                    AS loaded_without_nid;
```

### N4 — body parity, staged vs loaded (content never exposed)

Recomputes the importer's body assembly (`title\n\nsummary\n\nnotes`, with
the same key precedence and `{value,format}` / array unwrapping as
`extractS1LogNoteBody`) in pure SQL and compares by md5+length only.

Gates: `body_mismatch = 0`; `long_notes_match = long_notes` (the ≥2000-char
population is the "long notes" sample); multi-value notes are covered because
array parts join with the same `\n\n` separator — validated on dev against a
3-part multi-value fixture and a 5k-char fixture.

```sql
WITH staged AS (
  SELECT r.nid, r.title, r.fields
    FROM s1_staging.records r
    JOIN s1_staging.id_map m ON m.entity = 's1_log_note' AND m.s1_id = r.nid
   WHERE r.bundle = 'sirius_log'
), parts AS (
  SELECT s.nid, NULLIF(TRIM(s.title), '') AS title,
    COALESCE(
      CASE jsonb_typeof(s.fields->'field_sirius_log_summary')
        WHEN 'string' THEN s.fields->>'field_sirius_log_summary'
        WHEN 'number' THEN s.fields->>'field_sirius_log_summary'
        WHEN 'object' THEN COALESCE(s.fields->'field_sirius_log_summary'->>'value', s.fields->'field_sirius_log_summary'->>'text',
                                    s.fields->'field_sirius_log_summary'->>'message', s.fields->'field_sirius_log_summary'->>'body',
                                    s.fields->'field_sirius_log_summary'->>'content')
        WHEN 'array' THEN (SELECT string_agg(CASE WHEN jsonb_typeof(e) = 'object'
                                  THEN COALESCE(e->>'value', e->>'text', e->>'message', e->>'body', e->>'content')
                                  ELSE e #>> '{}' END, E'\n\n' ORDER BY o)
                             FROM jsonb_array_elements(s.fields->'field_sirius_log_summary') WITH ORDINALITY t(e, o))
      END,
      CASE jsonb_typeof(s.fields->'field_sirius_summary')
        WHEN 'string' THEN s.fields->>'field_sirius_summary'
        WHEN 'number' THEN s.fields->>'field_sirius_summary'
        WHEN 'object' THEN COALESCE(s.fields->'field_sirius_summary'->>'value', s.fields->'field_sirius_summary'->>'text',
                                    s.fields->'field_sirius_summary'->>'message', s.fields->'field_sirius_summary'->>'body',
                                    s.fields->'field_sirius_summary'->>'content')
        WHEN 'array' THEN (SELECT string_agg(CASE WHEN jsonb_typeof(e) = 'object'
                                  THEN COALESCE(e->>'value', e->>'text', e->>'message', e->>'body', e->>'content')
                                  ELSE e #>> '{}' END, E'\n\n' ORDER BY o)
                             FROM jsonb_array_elements(s.fields->'field_sirius_summary') WITH ORDINALITY t(e, o))
      END) AS summary,
    COALESCE(
      CASE jsonb_typeof(s.fields->'field_sirius_log_notes')
        WHEN 'string' THEN s.fields->>'field_sirius_log_notes'
        WHEN 'number' THEN s.fields->>'field_sirius_log_notes'
        WHEN 'object' THEN COALESCE(s.fields->'field_sirius_log_notes'->>'value', s.fields->'field_sirius_log_notes'->>'text',
                                    s.fields->'field_sirius_log_notes'->>'message', s.fields->'field_sirius_log_notes'->>'body',
                                    s.fields->'field_sirius_log_notes'->>'content')
        WHEN 'array' THEN (SELECT string_agg(CASE WHEN jsonb_typeof(e) = 'object'
                                  THEN COALESCE(e->>'value', e->>'text', e->>'message', e->>'body', e->>'content')
                                  ELSE e #>> '{}' END, E'\n\n' ORDER BY o)
                             FROM jsonb_array_elements(s.fields->'field_sirius_log_notes') WITH ORDINALITY t(e, o))
      END,
      CASE jsonb_typeof(s.fields->'field_sirius_notes')
        WHEN 'string' THEN s.fields->>'field_sirius_notes'
        WHEN 'number' THEN s.fields->>'field_sirius_notes'
        WHEN 'object' THEN COALESCE(s.fields->'field_sirius_notes'->>'value', s.fields->'field_sirius_notes'->>'text',
                                    s.fields->'field_sirius_notes'->>'message', s.fields->'field_sirius_notes'->>'body',
                                    s.fields->'field_sirius_notes'->>'content')
        WHEN 'array' THEN (SELECT string_agg(CASE WHEN jsonb_typeof(e) = 'object'
                                  THEN COALESCE(e->>'value', e->>'text', e->>'message', e->>'body', e->>'content')
                                  ELSE e #>> '{}' END, E'\n\n' ORDER BY o)
                             FROM jsonb_array_elements(s.fields->'field_sirius_notes') WITH ORDINALITY t(e, o))
      END,
      CASE jsonb_typeof(s.fields->'field_sirius_log_message')
        WHEN 'string' THEN s.fields->>'field_sirius_log_message'
        WHEN 'object' THEN COALESCE(s.fields->'field_sirius_log_message'->>'value', s.fields->'field_sirius_log_message'->>'text')
        WHEN 'array' THEN (SELECT string_agg(CASE WHEN jsonb_typeof(e) = 'object'
                                  THEN COALESCE(e->>'value', e->>'text') ELSE e #>> '{}' END, E'\n\n' ORDER BY o)
                             FROM jsonb_array_elements(s.fields->'field_sirius_log_message') WITH ORDINALITY t(e, o))
      END,
      CASE jsonb_typeof(s.fields->'field_sirius_message')
        WHEN 'string' THEN s.fields->>'field_sirius_message'
        WHEN 'object' THEN COALESCE(s.fields->'field_sirius_message'->>'value', s.fields->'field_sirius_message'->>'text')
        WHEN 'array' THEN (SELECT string_agg(CASE WHEN jsonb_typeof(e) = 'object'
                                  THEN COALESCE(e->>'value', e->>'text') ELSE e #>> '{}' END, E'\n\n' ORDER BY o)
                             FROM jsonb_array_elements(s.fields->'field_sirius_message') WITH ORDINALITY t(e, o))
      END) AS notes
  FROM staged s
), expected AS (
  SELECT nid,
         NULLIF(concat_ws(E'\n\n',
           title,
           summary,
           notes), '') AS body
    FROM parts
)
SELECT count(*)                                                             AS in_scope_loaded,
       count(*) FILTER (WHERE md5(COALESCE(n.body,'')) = md5(COALESCE(e.body,''))) AS body_match,
       count(*) FILTER (WHERE md5(COALESCE(n.body,'')) <> md5(COALESCE(e.body,''))) AS body_mismatch,
       count(*) FILTER (WHERE length(COALESCE(n.body,'')) >= 2000)          AS long_notes,
       count(*) FILTER (WHERE length(COALESCE(n.body,'')) >= 2000
                          AND md5(COALESCE(n.body,'')) = md5(COALESCE(e.body,''))) AS long_notes_match,
       max(length(n.body))                                                  AS max_note_len
  FROM expected e
  JOIN s1_staging.id_map m ON m.entity = 's1_log_note' AND m.s1_id = e.nid
  JOIN notes n ON n.id = m.s2_id;
```

Known benign divergence class: the SQL and the importer can disagree on rows
whose text fields hold shapes outside `{value,…}`/string/number/array-of-those
(N7 finds them), or empty-string-only parts. A nonzero `body_mismatch` is a
triage signal, not automatically an importer bug — pull the N9 nid sample and
re-derive by hand in chat.

### N5 — creator provenance buckets

Gates: `mapped_bad = 0`, `unmapped_but_userid_bad = 0`,
`no_provenance_at_all = 0` (every note carries UID and/or display name unless
the source node truly had `uid` NULL), `subject_provenance_bad = 0` (the
subject's `Imported Note [user: …]` matches stored provenance).
`mapped_ok + unmapped_with_provenance` should equal `total` minus any
NULL-uid source rows.

```sql
WITH loaded AS (
  SELECT n.id, n.user_id,
         NULLIF(n.data->'s1'->>'creatorUid','')::bigint AS creator_uid,
         NULLIF(n.data->'s1'->>'creatorDisplayName','') AS creator_display_name,
         n.subject
    FROM notes n
   WHERE n.data->>'s1Loader' = 's1-log-notes'
), joined AS (
  SELECT l.*, m.s2_id AS mapped_user_id,
         (m.s1_id IS NOT NULL AND NOT m.stub AND u.id IS NOT NULL) AS creator_mapped
    FROM loaded l
    LEFT JOIN s1_staging.id_map m ON m.entity = 'user' AND m.s1_id = l.creator_uid
    LEFT JOIN users u ON u.id = m.s2_id AND NOT m.stub
)
SELECT count(*) AS total,
  count(*) FILTER (WHERE creator_mapped AND user_id = mapped_user_id)                    AS mapped_ok,
  count(*) FILTER (WHERE creator_mapped AND (user_id IS DISTINCT FROM mapped_user_id))   AS mapped_bad,
  count(*) FILTER (WHERE NOT creator_mapped AND user_id IS NULL
                     AND (creator_uid IS NOT NULL OR creator_display_name IS NOT NULL))  AS unmapped_with_provenance,
  count(*) FILTER (WHERE NOT creator_mapped AND user_id IS NOT NULL)                     AS unmapped_but_userid_bad,
  count(*) FILTER (WHERE NOT creator_mapped AND user_id IS NULL
                     AND creator_uid IS NULL AND creator_display_name IS NULL)           AS no_provenance_at_all,
  count(*) FILTER (WHERE subject <> 'Imported Note [user: ' ||
      COALESCE(creator_display_name,
               CASE WHEN creator_uid IS NULL THEN 'Unknown S1 user'
                    ELSE 'S1 user ' || creator_uid END) || ']')                          AS subject_provenance_bad
FROM joined;
```

### N5c — source-to-loaded creator UID parity

The independent provenance gate: joins each loaded note back to its staged
source record and compares the stored `creatorUid` against the source node's
`uid` directly — a loader defect recording the wrong UID fails here even if
N5/N5b's internal consistency passes. Gates: `uid_invented = 0`,
`uid_wrong_or_missing = 0` (`source_uid_null_ok` counts source rows whose
`uid` is genuinely NULL — allowed, informational).

```sql
SELECT count(*) AS loaded,
  count(*) FILTER (WHERE r.uid IS NULL AND n.data->'s1'->>'creatorUid' IS NOT NULL) AS uid_invented,
  count(*) FILTER (WHERE r.uid IS NOT NULL
                     AND NULLIF(n.data->'s1'->>'creatorUid','')::bigint IS DISTINCT FROM r.uid) AS uid_wrong_or_missing,
  count(*) FILTER (WHERE r.uid IS NULL AND n.data->'s1'->>'creatorUid' IS NULL)     AS source_uid_null_ok
  FROM s1_staging.id_map m
  JOIN notes n ON n.id = m.s2_id
  JOIN s1_staging.records r ON r.bundle = 'sirius_log' AND r.nid = m.s1_id
 WHERE m.entity = 's1_log_note';
```

### N5b — display-name provenance vs staged raw_users

Gate: `display_name_bad = 0` (stored display name equals the staged S1
account name, trimmed-empty treated as absent; both NULL when the uid never
existed in `raw_users`).

```sql
SELECT count(*) AS with_creator_uid,
       count(*) FILTER (WHERE NULLIF(n.data->'s1'->>'creatorDisplayName','')
                        IS DISTINCT FROM NULLIF(TRIM(ru.name),'')) AS display_name_bad
  FROM notes n
  LEFT JOIN s1_staging.raw_users ru ON ru.uid = NULLIF(n.data->'s1'->>'creatorUid','')::bigint
 WHERE n.data->>'s1Loader' = 's1-log-notes'
   AND n.data->'s1'->>'creatorUid' IS NOT NULL;
```

### N6 — source-shape census: category/type pairs staged vs imported

Informational, aggregate-only. Rows with `imported = 0`: excluded families
and unclassified pairs (candidates for a transform ruling — cross-check the
workbook allowlist in `scripts/s1-migration/lib/log-notes.ts`), plus
approved pairs whose handler could not resolve to a worker (orphans —
reconcile against the run report's `resolutionCounts`). Any *approved* pair
with a large staged−imported gap not explained by orphans is a finding.

```sql
WITH staged AS (
  SELECT r.nid,
    LOWER(TRIM(regexp_replace(COALESCE(
      CASE jsonb_typeof(r.fields->'field_sirius_log_category')
        WHEN 'string' THEN r.fields->>'field_sirius_log_category'
        WHEN 'object' THEN r.fields->'field_sirius_log_category'->>'value'
        WHEN 'array'  THEN COALESCE(r.fields->'field_sirius_log_category'->0->>'value', r.fields->'field_sirius_log_category'->>0)
      END,
      CASE jsonb_typeof(r.fields->'field_sirius_category')
        WHEN 'string' THEN r.fields->>'field_sirius_category'
        WHEN 'object' THEN r.fields->'field_sirius_category'->>'value'
        WHEN 'array'  THEN COALESCE(r.fields->'field_sirius_category'->0->>'value', r.fields->'field_sirius_category'->>0)
      END), '\s+', ' ', 'g'))) AS category,
    LOWER(TRIM(regexp_replace(COALESCE(
      CASE jsonb_typeof(r.fields->'field_sirius_log_type')
        WHEN 'string' THEN r.fields->>'field_sirius_log_type'
        WHEN 'object' THEN r.fields->'field_sirius_log_type'->>'value'
        WHEN 'array'  THEN COALESCE(r.fields->'field_sirius_log_type'->0->>'value', r.fields->'field_sirius_log_type'->>0)
      END,
      CASE jsonb_typeof(r.fields->'field_sirius_type')
        WHEN 'string' THEN r.fields->>'field_sirius_type'
        WHEN 'object' THEN r.fields->'field_sirius_type'->>'value'
        WHEN 'array'  THEN COALESCE(r.fields->'field_sirius_type'->0->>'value', r.fields->'field_sirius_type'->>0)
      END), '\s+', ' ', 'g'))) AS type,
    EXISTS (SELECT 1 FROM s1_staging.id_map m
             WHERE m.entity = 's1_log_note' AND m.s1_id = r.nid) AS imported
  FROM s1_staging.records r
  WHERE r.bundle = 'sirius_log'
)
SELECT COALESCE(category,'(none)') AS category, COALESCE(type,'(none)') AS type,
       count(*) AS staged, count(*) FILTER (WHERE imported) AS imported
  FROM staged
 GROUP BY 1, 2
 ORDER BY staged DESC, 1, 2;
```

### N7 — text-field shape variant census

Gate for the parity method: `unkeyed_object_rows = 0`. Nonzero means text
objects with none of the known content keys (`value`/`text`/`message`/
`body`/`content`) — the importer flattens them via `Object.values` while N4
cannot; those rows need a transform ruling and will surface as N4 mismatches.
`multi_value_rows` sizes the multi-value population N4's parity covers.

```sql
WITH k AS (
  SELECT r.nid, key, jsonb_typeof(r.fields->key) AS shape,
         CASE WHEN jsonb_typeof(r.fields->key) = 'array'
              THEN jsonb_array_length(r.fields->key) END AS arr_len,
         CASE WHEN jsonb_typeof(r.fields->key) = 'object'
              THEN NOT (r.fields->key ?| ARRAY['value','text','message','body','content'])
              WHEN jsonb_typeof(r.fields->key) = 'array'
              THEN EXISTS (SELECT 1 FROM jsonb_array_elements(r.fields->key) e
                            WHERE jsonb_typeof(e) = 'object'
                              AND NOT (e ?| ARRAY['value','text','message','body','content']))
              ELSE false END AS unkeyed_object
    FROM s1_staging.records r
    CROSS JOIN unnest(ARRAY['field_sirius_log_summary','field_sirius_summary',
                            'field_sirius_log_notes','field_sirius_notes',
                            'field_sirius_log_message','field_sirius_message']) AS key
   WHERE r.bundle = 'sirius_log' AND r.fields ? key
)
SELECT key, shape,
       count(*) AS rows,
       count(*) FILTER (WHERE arr_len > 1)     AS multi_value_rows,
       count(*) FILTER (WHERE unkeyed_object)  AS unkeyed_object_rows
  FROM k
 GROUP BY 1, 2
 ORDER BY 1, 2;
```

### N8 — note-type × medium distribution

Cross-check against the run report's `classificationCounts`. Expected
relationship: per-key counts here = report counts **minus that key's orphaned
rows** (the report counts every in-scope row before handler resolution; only
resolved rows become notes).

```sql
SELECT ot.name AS note_type,
       COALESCE((SELECT t.name
                   FROM sitespecific_bao_notes_tags a
                   JOIN options_sitespecific_bao_notes_tags t ON t.id = a.tag_id
                  WHERE a.note_id = n.id
                    AND t.data->>'s1SourceId' LIKE 's1-log-notes:tag:medium:%'
                  LIMIT 1), '(no medium)') AS medium,
       count(*) AS notes
  FROM notes n
  JOIN options_note_type ot ON ot.id = n.type_id
 WHERE n.data->>'s1Loader' = 's1-log-notes'
 GROUP BY 1, 2
 ORDER BY 1, 2;
```

### N8b — issue-tag totals

```sql
SELECT t.name AS issue_tag, count(*) AS assignments
  FROM sitespecific_bao_notes_tags a
  JOIN options_sitespecific_bao_notes_tags t ON t.id = a.tag_id
  JOIN notes n ON n.id = a.note_id
 WHERE n.data->>'s1Loader' = 's1-log-notes'
   AND t.data->>'s1SourceId' LIKE 's1-log-notes:tag:issue:%'
 GROUP BY 1 ORDER BY 2 DESC, 1;
```

### N9 — mismatch sample ⚠ (output carries nids — chat only; run only if N4 `body_mismatch > 0`)

Swap the md5 comparison from N4's final SELECT to list disagreeing nids:
re-run N4 with the final SELECT replaced by

```sql
SELECT e.nid, length(COALESCE(n.body,'')) AS s2_len, length(COALESCE(e.body,'')) AS expected_len
  FROM expected e
  JOIN s1_staging.id_map m ON m.entity = 's1_log_note' AND m.s1_id = e.nid
  JOIN notes n ON n.id = m.s2_id
 WHERE md5(COALESCE(n.body,'')) <> md5(COALESCE(e.body,''))
 ORDER BY e.nid LIMIT 25;
```

---

## 4. M-series — S1 MariaDB (CloudShell VPC tab)

### M1 — source totals and category/type census

`sirius_logs` bounds `staged_logs` (N0); the census cross-checks N6 from the
live source (extract-vs-source drift check). Trim the LIMIT as needed.

```sql
SELECT COUNT(*) AS sirius_logs FROM node WHERE type = 'sirius_log';

SELECT COALESCE(LOWER(TRIM(c.field_sirius_category_value)),'(none)') AS category,
       COALESCE(LOWER(TRIM(t.field_sirius_type_value)),'(none)')     AS type,
       COUNT(*) AS n
FROM node p
LEFT JOIN field_data_field_sirius_category c
       ON c.entity_id = p.nid AND c.bundle = 'sirius_log' AND c.deleted = 0 AND c.delta = 0
LEFT JOIN field_data_field_sirius_type t
       ON t.entity_id = p.nid AND t.bundle = 'sirius_log' AND t.deleted = 0 AND t.delta = 0
WHERE p.type = 'sirius_log'
GROUP BY 1, 2 ORDER BY n DESC LIMIT 60;
```

### M2 — multi-value population per text/handler field

Sizes the multi-value note population (cross-check N7's
`multi_value_rows`; the field inventory says handler is multi with max delta
19 in production).

```sql
SELECT 'notes' AS field, COUNT(DISTINCT entity_id) AS multi_value_nodes
  FROM field_data_field_sirius_notes WHERE bundle = 'sirius_log' AND deleted = 0 AND delta > 0
UNION ALL
SELECT 'summary', COUNT(DISTINCT entity_id)
  FROM field_data_field_sirius_summary WHERE bundle = 'sirius_log' AND deleted = 0 AND delta > 0
UNION ALL
SELECT 'handler', COUNT(DISTINCT entity_id)
  FROM field_data_field_sirius_log_handler WHERE bundle = 'sirius_log' AND deleted = 0 AND delta > 0;
```

### M3 — long-body population

Cross-check N4's `long_notes` (staged/loaded side can only be ≤ this,
scoped to approved+resolved rows).

```sql
SELECT SUM(CHAR_LENGTH(field_sirius_notes_value) >= 2000) AS long_notes,
       MAX(CHAR_LENGTH(field_sirius_notes_value))         AS max_len
FROM field_data_field_sirius_notes
WHERE bundle = 'sirius_log' AND deleted = 0;
```

### M4 — creator account existence

`logs_with_deleted_creator > 0` means some notes can only ever carry
UID-without-display-name provenance (their S1 account is gone) — expected,
not a defect; reconcile against N5's `unmapped_with_provenance`.

```sql
SELECT COUNT(DISTINCT p.uid) AS distinct_creators,
       SUM(u.uid IS NULL)    AS logs_with_deleted_creator
FROM node p LEFT JOIN users u ON u.uid = p.uid
WHERE p.type = 'sirius_log';
```

---

## 5. Gate summary (maps to the task's done criteria)

| Done criterion | Queries | Gate |
|---|---|---|
| Long/multi-value body parity, no content exposed | N4 (+N7, N9) | `body_mismatch = 0`, `long_notes_match = long_notes`, `unkeyed_object_rows = 0` |
| Mapped creators → `notes.user_id`; unmapped keep UID/display-name | N5, N5c, N5b, M4 | all `*_bad = 0`, `no_provenance_at_all = 0`, `uid_invented = 0`, `uid_wrong_or_missing = 0` |
| Rerun updates in place, no duplicate mappings | OP-3, N2, N3 | rerun `created/updated/deleted = 0` with `unchanged + immutableSkipped` = first-run total; `dup_note_targets = 0`; `id_mapped = loaded_notes` |
| Aggregate mismatches + shape variants recorded | N6, N7, M1–M3 | census paste-backs folded into §7 below |

---

## 6. Paste-back checklist (operator → chat)

1. N0 + N1 preflight (and OP-1b + re-run N1 if collisions).
2. OP-2 create-run JSON + OP-3 rerun JSON.
3. N2–N8b outputs incl. N5c (N9 only if N4 mismatches; nid outputs stay in chat).
4. M1–M4 outputs.
5. Any transform-ruling candidates (N6 unclassified pairs with material
   volume, N7 `unkeyed_object_rows`, N4/N9 mismatch classes).

## 7. Rehearsal results

*(to be filled from the operator paste-backs — aggregates and rulings only)*

### 7.1 Dev validation evidence (2026-08-27)

Fixture-scale dry-run of this entire kit on the dev DB (66 staged
`sirius_log` rows incl. long/multi-value/excluded fixtures):

- OP-1 preflight found the §1 collisions; the candidate rows were inspected
  and confirmed as component seeds, then adopted per OP-1b (id-pinned
  statements, each `UPDATE 1`); loader then ran clean: create run 9 created /
  6 unchanged, rerun 0/0/0 with 15 unchanged. N1 re-run: 0 rows.
- N3 gates all 0; `id_mapped = loaded_notes = 15`.
- N4: 15/15 body match, including one ≥2000-char note (5,457 chars) and one
  3-part multi-value note; 0 mismatches.
- N5: 4 mapped creators all `mapped_ok`; 11 unmapped all with provenance;
  every `*_bad` bucket 0; N5b `display_name_bad = 0`; N5c `uid_invented = 0`,
  `uid_wrong_or_missing = 0` across all 15 (source→loaded UID parity).
- N7: no unkeyed text objects in dev staging.
- M1–M4 ran verbatim on the dev S1 MariaDB (synthetic data), shapes as
  expected (handler is the only multi-value field there).
