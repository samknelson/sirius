-- Read-only, aggregate-only review. Run ONLY with explicit environment approval.
-- psql script; never accepts an environment URL or exports raw identifiers.
\set ON_ERROR_STOP on
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

SELECT to_regclass('public.ledger_ea') IS NOT NULL AS has_ea,
       to_regclass('public.ledger_accounts') IS NOT NULL AS has_accounts,
       to_regclass('public.ledger_payment_attempts') IS NOT NULL AS has_attempts,
       to_regclass('public.ledger_payments') IS NOT NULL AS has_payments,
       to_regclass('public.winston_logs') IS NOT NULL AS has_logs
\gset

SELECT t.tgname AS protection, t.tgenabled AS enabled_mode, count(*) AS installed_count
FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND NOT t.tgisinternal
  AND ((c.relname='ledger_ea' AND t.tgname='ledger_ea_identity_immutable')
    OR (c.relname='ledger_accounts' AND t.tgname='ledger_accounts_currency_immutable'))
GROUP BY t.tgname,t.tgenabled ORDER BY t.tgname;
-- Expect two rows with enabled_mode A when both tables are present.

\if :has_ea
SELECT CASE WHEN entity_type IN ('worker','employer','provider','trust_provider','trustProvider','contact')
  THEN entity_type ELSE '[other spelling]' END AS entity_type_group, count(*) AS ea_count
FROM public.ledger_ea GROUP BY 1 ORDER BY 1;
SELECT count(*) AS duplicate_account_entity_groups FROM (
  SELECT account_id,entity_id FROM public.ledger_ea GROUP BY account_id,entity_id HAVING count(*)>1
) duplicates;
-- Zero does NOT prove type-aware lookups cannot conflict with the type-blind UNIQUE.
\if :has_accounts
\if :has_attempts
SELECT count(*) AS attempts,
  count(*) FILTER (WHERE ea.id IS NULL) AS missing_ea,
  count(*) FILTER (WHERE ea.id IS NOT NULL AND ROW(a.account_id,a.entity_type,a.entity_id)
    IS DISTINCT FROM ROW(ea.account_id,ea.entity_type,ea.entity_id)) AS coordinate_mismatches,
  count(*) FILTER (WHERE ac.id IS NULL) AS missing_current_account,
  count(*) FILTER (WHERE ac.id IS NOT NULL AND upper(a.currency) IS DISTINCT FROM upper(ac.currency_code)) AS currency_mismatches
FROM public.ledger_payment_attempts a
LEFT JOIN public.ledger_ea ea ON ea.id=a.ledger_ea_id
LEFT JOIN public.ledger_accounts ac ON ac.id=ea.account_id;
\if :has_payments
SELECT count(*) AS attempts_with_linked_payment,
  count(*) FILTER (WHERE p.id IS NULL) AS missing_payment,
  count(*) FILTER (WHERE p.id IS NOT NULL AND p.ledger_ea_id IS DISTINCT FROM a.ledger_ea_id) AS primary_ea_mismatches,
  count(*) FILTER (WHERE p.id IS NOT NULL AND p.details->>'paymentAttemptId' IS DISTINCT FROM a.id) AS provider_marker_mismatches
FROM public.ledger_payment_attempts a LEFT JOIN public.ledger_payments p ON p.id=a.ledger_payment_id
WHERE a.ledger_payment_id IS NOT NULL;
\endif
\else
\echo 'Attempt snapshot review skipped: attempts table absent.'
\endif
\endif
\else
\echo 'EA integrity review skipped: ledger_ea absent.'
\endif

\if :has_logs
-- Raw successful default before/after shape only. Wrapped/legacy/incomplete
-- shapes remain UNKNOWN, not automatically attributed or declared unchanged.
WITH candidates AS (
  SELECT module,meta FROM public.winston_logs
  WHERE operation='update' AND module IN ('ledger.ea','ledger.accounts','ledger.payments')
    AND level='info'
), comparable AS (
  SELECT *,
    (meta->'before' ?& ARRAY['entityType','entityId','accountId']
      AND meta->'after' ?& ARRAY['entityType','entityId','accountId']) AS ea_complete
  FROM candidates
)
SELECT module,count(*) AS retained_update_candidates,
  count(*) FILTER (WHERE module='ledger.ea' AND ea_complete) AS comparable_ea_snapshots,
  count(*) FILTER (WHERE module='ledger.ea' AND ea_complete AND
    ROW(meta->'before'->>'entityType',meta->'before'->>'entityId',meta->'before'->>'accountId')
    IS DISTINCT FROM ROW(meta->'after'->>'entityType',meta->'after'->>'entityId',meta->'after'->>'accountId')) AS observed_ea_identity_changes,
  count(*) FILTER (WHERE module='ledger.accounts' AND meta->'before' ? 'currencyCode' AND meta->'after' ? 'currencyCode'
    AND meta->'before'->>'currencyCode' IS DISTINCT FROM meta->'after'->>'currencyCode') AS observed_currency_changes,
  count(*) FILTER (WHERE module='ledger.accounts' AND meta->'before' ? 'siriusId' AND meta->'after' ? 'siriusId'
    AND meta->'before'->>'siriusId' IS DISTINCT FROM meta->'after'->>'siriusId') AS observed_external_mapping_changes,
  count(*) FILTER (WHERE module='ledger.accounts' AND meta->'before' ? 'gatewayConfigId' AND meta->'after' ? 'gatewayConfigId'
    AND meta->'before'->>'gatewayConfigId' IS DISTINCT FROM meta->'after'->>'gatewayConfigId') AS observed_gateway_changes,
  count(*) FILTER (WHERE module='ledger.payments' AND meta->'before' ? 'ledgerEaId' AND meta->'after' ? 'ledgerEaId'
    AND meta->'before'->>'ledgerEaId' IS DISTINCT FROM meta->'after'->>'ledgerEaId') AS observed_payment_reattributions
FROM comparable GROUP BY module ORDER BY module;
\else
\echo 'Historical audit review skipped: winston_logs absent.'
\endif
ROLLBACK;
