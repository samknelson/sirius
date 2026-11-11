/**
 * SQL variants used by the historical authority migration, the varchar
 * conversion migration, and empty-database bootstrap. Keep the signatures
 * version-specific: migration 1192 runs before the integer-to-varchar change.
 *
 * Do not make an unconditional `nextval()` default for workers.sirius_id:
 * during the S1 migration it would create a locally invented claim whenever
 * any writer omits the SID.  The dynamic query intentionally avoids requiring
 * `variables` to exist when empty-db bootstrap creates this function before
 * the tables.
 */
function workerSiriusIdFunctionSql(returnType: "integer" | "varchar") {
  const resultCast = returnType === "integer" ? "integer" : "varchar";
  return `
  CREATE OR REPLACE FUNCTION worker_sirius_id_default()
  RETURNS ${returnType}
  LANGUAGE plpgsql
  VOLATILE
  AS $worker_sirius_id_default$
  DECLARE
    authority text;
  BEGIN
    EXECUTE
      'SELECT value #>> ''{}'' FROM variables WHERE name = $1'
      INTO authority
      USING 'worker_sirius_id_authority';

    IF authority IS DISTINCT FROM 's2' THEN
      RETURN NULL;
    END IF;

    RETURN nextval(pg_get_serial_sequence('workers', 'sirius_id'))::${resultCast};
  END;
  $worker_sirius_id_default$;
`;
}

/**
 * Migration 1192 imports this legacy form and runs before migration 1207, while
 * workers.sirius_id is still integer. Keep its return type compatible.
 */
export const workerSiriusIdDefaultFunctionSql = workerSiriusIdFunctionSql("integer");

/** Current default used by fresh bootstrap and the varchar conversion migration. */
export const workerSiriusIdVarcharDefaultFunctionSql = workerSiriusIdFunctionSql("varchar");

/** Fresh-bootstrap companion for the retained pre-cutover serial sequence. */
export const workerSiriusIdSequenceCreateSql =
  "CREATE SEQUENCE IF NOT EXISTS workers_sirius_id_seq AS integer";

/** Establishes the association `pg_get_serial_sequence` relies on. */
export const workerSiriusIdSequenceOwnershipSql =
  "ALTER SEQUENCE workers_sirius_id_seq OWNED BY workers.sirius_id";