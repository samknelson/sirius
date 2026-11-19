-- Kaiser EDI real-data verification, step 2 of 3: compare start dates and
-- COBRA flags.
--
-- Run in the staging or production database from an authorized SQL console,
-- AFTER the new run has been generated (see the runbook,
-- docs/tasks/1021-kaiser-edi-real-data-verification.md).
-- Read-only: it reads the saved rows of two wizard runs and today's coverage
-- records, and changes nothing. Never supply a connection string.
--
-- It answers two questions.
--
--   FILE COMPARISON   Every row of the old-rule file against the new file for
--                     the same month: coverage start date and COBRA
--                     enrollment unit (7000 / 0000).
--   RULE COMPARISON   Every row of the new file against the OLD rule worked
--                     out again from today's coverage records (walk back
--                     month by month while the person holds a record with the
--                     same subscriber/dependent source and COBRA class). This
--                     separates "the rule changed the value" from "coverage
--                     changed between the two files".
--
-- With edi.detail = 'off' (the default) the result is counts only and may be
-- shared outside the database's privacy boundary. With 'on' it also returns one
-- line per row that needs a person to look at it, naming record and person
-- IDs: keep that output inside the boundary.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '300s';
SET LOCAL lock_timeout = '2s';

-- EDIT: paste the two wizard ids from step 1. Leave the old run empty ('') to
-- run the RULE COMPARISON alone when no old-rule file exists for the month.
SELECT set_config('edi.old_run', 'PASTE-OLD-RUN-WIZARD-ID', true) AS old_run,
       set_config('edi.new_run', 'PASTE-NEW-RUN-WIZARD-ID', true) AS new_run,
       set_config('edi.detail', 'off', true) AS detail;

-- The two runs. same_month must be true for the file comparison to mean
-- anything; new_run_rule must be 'lifecycle events (new rule)'.
SELECT current_database() AS database_name,
       o.id AS old_run, o.data->'input'->>'asOfDate' AS old_as_of,
       o.data->'reportMeta'->>'generatedAt' AS old_generated_at,
       CASE WHEN o.id IS NULL THEN 'none supplied'
            WHEN o.data->'reportMeta'->'coverage'->>'exclusionDigest' IS NULL THEN 'history scan (old rule)'
            ELSE 'lifecycle events (new rule)' END AS old_run_rule,
       n.id AS new_run, n.data->'input'->>'asOfDate' AS new_as_of,
       n.data->'reportMeta'->>'generatedAt' AS new_generated_at,
       CASE WHEN n.data->'reportMeta'->'coverage'->>'exclusionDigest' IS NULL THEN 'history scan (old rule)'
            ELSE 'lifecycle events (new rule)' END AS new_run_rule,
       left(o.data->'input'->>'asOfDate', 7) = left(n.data->'input'->>'asOfDate', 7) AS same_month,
       n.data->'reportMeta'->'coverage'->>'exclusionCount' AS new_exclusions,
       n.data->'reportMeta'->'coverage'->>'warningCount' AS new_warnings,
       n.data->'coverageSnapshot'->'timings' AS coverage_check_timings_ms
FROM public.wizards n
LEFT JOIN public.wizards o ON o.id = current_setting('edi.old_run') AND o.type = 'trust_provider_edi'
WHERE n.id = current_setting('edi.new_run') AND n.type = 'trust_provider_edi';

WITH params AS (
  SELECT current_setting('edi.old_run') AS old_id, current_setting('edi.new_run') AS new_id,
         current_setting('edi.detail') = 'on' AS detail,
         -- The Kaiser file never reports a start before the Kaiser go-live date
         -- (sitespecific-bao-kaiser.ts). Termination rows are not floored.
         2025 * 12 + 8 - 1 AS floor_idx
), cobra_employer AS (
  -- COBRA_EMPLOYER_SIRIUS_IDS in coverage-segments.ts.
  SELECT e.id FROM public.employers e WHERE e.sirius_id IN ('COBRA', '13226164')
), file_row AS (
  SELECT CASE WHEN r.wizard_id = p.new_id THEN 'new' ELSE 'old' END AS run, r.pk,
         CASE WHEN r.pk LIKE 'term:%' THEN 'termination'
              WHEN r.data->>'recordCode' = 'D' THEN 'dependent' ELSE 'subscriber' END AS row_kind,
         coalesce(r.data->>'coverageStart', '') AS coverage_start,
         coalesce(r.data->>'enrollmentUnit', '') AS unit,
         -- Used only to pair a member whose coverage record was replaced (new
         -- record id) between the two files. Never returned.
         md5(concat_ws('|', r.data->>'recordCode', r.data->>'subscriberSsn', r.data->>'memberSsn',
           r.data->>'birthDate', lower(r.data->>'firstName'), r.data->>'coverageEnd')) AS identity
  FROM public.wizard_report_data r CROSS JOIN params p
  WHERE r.wizard_id IN (p.old_id, p.new_id) AND r.pk NOT LIKE 'coverage-entry:%'
), by_id AS (
  SELECT o.pk AS old_pk, n.pk AS new_pk
  FROM file_row o JOIN file_row n ON n.run = 'new' AND n.pk = o.pk WHERE o.run = 'old'
), leftover AS (
  SELECT f.*, row_number() OVER (PARTITION BY f.run, f.identity ORDER BY f.coverage_start, f.unit, f.pk) AS position
  FROM file_row f
  WHERE NOT EXISTS (SELECT 1 FROM by_id b WHERE (f.run = 'old' AND b.old_pk = f.pk) OR (f.run = 'new' AND b.new_pk = f.pk))
), pair AS (
  SELECT old_pk, new_pk, 'record id' AS paired_by FROM by_id
  UNION ALL
  SELECT o.pk, n.pk, CASE WHEN o.pk IS NOT NULL AND n.pk IS NOT NULL THEN 'member identity' END
  FROM (SELECT * FROM leftover WHERE run = 'old') o
  FULL JOIN (SELECT * FROM leftover WHERE run = 'new') n ON n.identity = o.identity AND n.position = o.position
), keyed AS (
  -- What each row's key says about whose coverage it reports:
  --   subscriber  <coverage record id>
  --   dependent   <subscriber coverage record id>:<relationship id>
  --   termination term:<benefit id>:<person id>:<family coverage record id>:<last covered date>
  SELECT p.old_pk, p.new_pk, p.paired_by, o.row_kind AS old_kind, n.row_kind AS new_kind,
         o.coverage_start AS old_start, n.coverage_start AS new_start, o.unit AS old_unit, n.unit AS new_unit,
         coalesce(n.row_kind, o.row_kind) AS row_kind, k.pk,
         CASE coalesce(n.row_kind, o.row_kind) WHEN 'termination' THEN split_part(k.pk, ':', 4)
              ELSE split_part(k.pk, ':', 1) END AS family_record_id,
         CASE WHEN coalesce(n.row_kind, o.row_kind) = 'dependent' THEN nullif(split_part(k.pk, ':', 2), '') END AS relation_id,
         CASE WHEN coalesce(n.row_kind, o.row_kind) = 'termination' THEN split_part(k.pk, ':', 3) END AS term_person_id,
         CASE WHEN coalesce(n.row_kind, o.row_kind) = 'termination' THEN split_part(k.pk, ':', 2) END AS term_benefit_id,
         CASE WHEN coalesce(n.row_kind, o.row_kind) = 'termination' THEN split_part(k.pk, ':', 5) END AS term_end
  FROM pair p
  LEFT JOIN file_row o ON o.run = 'old' AND o.pk = p.old_pk
  LEFT JOIN file_row n ON n.run = 'new' AND n.pk = p.new_pk
  CROSS JOIN LATERAL (SELECT coalesce(p.new_pk, p.old_pk) AS pk) k
), anchored AS (
  -- The member's OWN coverage record: the one whose start date the row reports.
  SELECT k.*, fam.id IS NOT NULL AS family_record_exists,
         coalesce(k.term_person_id, rel.worker_2, fam.worker_id) AS person_id,
         a.id AS anchor_id, a.worker_id AS anchor_person, a.benefit_id AS anchor_benefit,
         a.source_relation_id AS anchor_relation, a.year * 12 + a.month - 1 AS anchor_idx,
         a.id IS NOT NULL AND a.employer_id IN (SELECT id FROM cobra_employer) AS anchor_cobra
  FROM keyed k
  LEFT JOIN public.trust_wmb fam ON fam.id = k.family_record_id
  LEFT JOIN public.worker_relations rel ON rel.id = k.relation_id
  LEFT JOIN LATERAL (
    SELECT w.* FROM public.trust_wmb w
    WHERE CASE k.row_kind
      WHEN 'subscriber' THEN w.id = k.family_record_id
      WHEN 'dependent' THEN w.source_relation_id = k.relation_id AND w.benefit_id = fam.benefit_id
        AND w.year = fam.year AND w.month = fam.month
      ELSE w.worker_id = k.term_person_id AND w.benefit_id = k.term_benefit_id
        AND w.year = left(k.term_end, 4)::int AND w.month = substr(k.term_end, 6, 2)::int
    END
    ORDER BY w.id LIMIT 1
  ) a ON true
), history AS (
  -- Each anchor's person and benefit, month by month up to the anchor month.
  SELECT a.pk, a.anchor_idx, w.year * 12 + w.month - 1 AS idx,
         bool_or(w.source_relation_id IS NOT DISTINCT FROM a.anchor_relation
           AND (w.employer_id IN (SELECT id FROM cobra_employer)) = a.anchor_cobra) AS same_class,
         count(DISTINCT coalesce(w.source_relation_id, '') || '|' ||
           (w.employer_id IN (SELECT id FROM cobra_employer))::text) AS classes
  FROM anchored a
  JOIN public.trust_wmb w ON w.worker_id = a.anchor_person AND w.benefit_id = a.anchor_benefit
    AND w.year * 12 + w.month - 1 <= a.anchor_idx
  WHERE a.anchor_id IS NOT NULL AND a.new_pk IS NOT NULL
  GROUP BY a.pk, a.anchor_idx, w.year * 12 + w.month - 1
), walked AS (
  SELECT h.*, row_number() OVER (PARTITION BY h.pk, h.same_class ORDER BY h.idx DESC) - 1 AS position
  FROM history h
), old_rule AS (
  -- A same-class month belongs to the run ending at the anchor month exactly
  -- when its distance from the anchor equals its position among them.
  SELECT w.pk, min(w.idx) FILTER (WHERE w.same_class AND w.anchor_idx - w.idx = w.position) AS start_idx,
         array_agg(w.idx) FILTER (WHERE w.classes > 1) AS conflict_months
  FROM walked w GROUP BY w.pk
), listed_entry AS (
  -- The new run's saved exclusion and warning list.
  SELECT e.data->'coverageEntry'->>'kind' AS kind, e.data->'coverageEntry'->>'reason' AS reason,
         e.data->'coverageEntry'->>'workerId' AS person_id, e.data->'coverageEntry'->'records' AS records
  FROM public.wizard_report_data e CROSS JOIN params p
  WHERE e.wizard_id = p.new_id AND e.pk LIKE 'coverage-entry:%'
), listed_person AS (
  SELECT person_id, bool_or(kind = 'exclusion') AS excluded FROM listed_entry GROUP BY person_id
), listed_record AS (
  SELECT DISTINCT record->>'id' AS record_id
  FROM listed_entry CROSS JOIN LATERAL jsonb_array_elements(records) AS record WHERE kind = 'exclusion'
), judged AS (
  SELECT a.*, p.floor_idx, p.detail, r.start_idx,
         -- The old rule refused a run when any month it walked through, or the
         -- month just before the start, held conflicting records.
         EXISTS (SELECT 1 FROM unnest(r.conflict_months) m WHERE m >= r.start_idx - 1) AS old_rule_refuses,
         CASE WHEN r.start_idx IS NULL THEN NULL ELSE to_char(make_date(
           (CASE WHEN a.row_kind = 'termination' THEN r.start_idx ELSE greatest(r.start_idx, p.floor_idx) END) / 12,
           (CASE WHEN a.row_kind = 'termination' THEN r.start_idx ELSE greatest(r.start_idx, p.floor_idx) END) % 12 + 1,
           1), 'YYYYMMDD') END AS old_rule_start,
         CASE WHEN a.anchor_cobra THEN '7000' ELSE '0000' END AS old_rule_unit,
         lp.person_id IS NOT NULL AS person_listed, coalesce(lp.excluded, false) AS person_excluded,
         EXISTS (SELECT 1 FROM listed_record lr WHERE lr.record_id IN (a.family_record_id, a.anchor_id)) AS record_excluded,
         EXISTS (SELECT 1 FROM public.trust_wmb later WHERE later.worker_id = a.term_person_id
           AND later.benefit_id = a.term_benefit_id
           AND later.year * 12 + later.month - 1 > left(a.term_end, 4)::int * 12 + substr(a.term_end, 6, 2)::int - 1) AS reinstated
  FROM anchored a CROSS JOIN params p
  LEFT JOIN old_rule r ON r.pk = a.pk
  LEFT JOIN listed_person lp ON lp.person_id = a.person_id
), verdict AS (
  SELECT j.*,
    CASE
      WHEN j.new_pk IS NULL THEN NULL
      WHEN j.anchor_id IS NULL THEN '5 cannot recompute: coverage record no longer exists (changed since the new file)'
      WHEN j.old_rule_refuses THEN '3 old rule would have stopped: conflicting month in the run (see warnings)'
      WHEN j.old_rule_start = j.new_start AND j.old_rule_unit = j.new_unit THEN '1 same start date and COBRA flag'
      WHEN j.person_listed THEN '2 differs, person is on the new run''s exclusion or warning list'
      ELSE '9 UNEXPLAINED: rules disagree on today''s records'
    END AS rule_outcome,
    CASE
      WHEN j.old_pk IS NULL AND j.new_pk IS NULL THEN NULL
      WHEN (SELECT old_id FROM params) = '' THEN NULL
      WHEN j.old_pk IS NOT NULL AND j.new_pk IS NOT NULL THEN CASE
        WHEN j.old_start = j.new_start AND j.old_unit = j.new_unit THEN '1 identical'
        WHEN j.person_listed OR j.record_excluded THEN '2 differs, person is on the new run''s exclusion or warning list'
        WHEN j.anchor_id IS NOT NULL AND NOT j.old_rule_refuses
          AND j.old_rule_start = j.new_start AND j.old_rule_unit = j.new_unit
          THEN '3 differs, coverage changed since the old file (old rule on today''s records gives the new value)'
        ELSE '9 UNEXPLAINED difference' END
      WHEN j.new_pk IS NULL THEN CASE
        WHEN j.person_excluded OR j.record_excluded THEN '4 only in old file: excluded by the new run (listed)'
        WHEN j.row_kind = 'termination' AND j.reinstated THEN '5 only in old file: ending retired, person has later coverage'
        WHEN j.row_kind <> 'termination' AND j.anchor_id IS NULL THEN '5 only in old file: coverage record no longer exists'
        ELSE '9 UNEXPLAINED: only in old file' END
      ELSE CASE
        WHEN j.row_kind = 'termination' THEN '6 only in new file: ending not in the old file (review settings and dates)'
        ELSE '6 only in new file: member not in the old file (coverage added, or old run left them out)' END
    END AS file_outcome
  FROM judged j
)
SELECT section, row_kind, outcome, paired_by, count(*) AS file_rows,
       NULL::text AS old_row_key, NULL::text AS new_row_key, NULL::text AS person_id,
       NULL::text AS old_start, NULL::text AS new_start, NULL::text AS old_rule_start_today,
       NULL::text AS old_unit, NULL::text AS new_unit, NULL::text AS old_rule_unit_today
FROM (
  SELECT 'FILE COMPARISON (old file vs new file)' AS section, row_kind, file_outcome AS outcome, paired_by FROM verdict
  WHERE file_outcome IS NOT NULL
  UNION ALL
  SELECT 'RULE COMPARISON (new file vs old rule on today''s records)', row_kind, rule_outcome, NULL FROM verdict
  WHERE rule_outcome IS NOT NULL
) counted
GROUP BY section, row_kind, outcome, paired_by
UNION ALL
SELECT 'DETAIL (keep inside the privacy boundary)', v.row_kind,
       concat_ws(' / ', 'file: ' || v.file_outcome, 'rule: ' || v.rule_outcome), v.paired_by, 1,
       v.old_pk, v.new_pk, v.person_id, v.old_start, v.new_start, v.old_rule_start,
       v.old_unit, v.new_unit, v.old_rule_unit
FROM verdict v
WHERE v.detail AND (v.file_outcome ~ '^[69]' OR v.rule_outcome ~ '^[59]')
ORDER BY 1 DESC, 2, 3, 4;

ROLLBACK;
