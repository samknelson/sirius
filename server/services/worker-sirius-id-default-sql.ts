/**
 * SQL shared by empty-database bootstrap and the registered migration.
 *
 * Do not make an unconditional `nextval()` default for workers.sirius_id:
 * during the S1 migration it would create a locally invented claim whenever
 * any writer omits the SID.  The dynamic query intentionally avoids requiring
 * `variables` to exist when empty-db bootstrap creates this function before
 * the tables.
 */
export const workerSiriusIdDefaultFunctionSql = `
  CREATE OR REPLACE FUNCTION worker_sirius_id_default()
  RETURNS integer
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

    RETURN nextval(pg_get_serial_sequence('workers', 'sirius_id'))::integer;
  END;
  $worker_sirius_id_default$;
`;

/** Fresh-bootstrap companion for the retained pre-cutover serial sequence. */
export const workerSiriusIdSequenceCreateSql =
  "CREATE SEQUENCE IF NOT EXISTS workers_sirius_id_seq AS integer";

/** Establishes the association `pg_get_serial_sequence` relies on. */
export const workerSiriusIdSequenceOwnershipSql =
  "ALTER SEQUENCE workers_sirius_id_seq OWNED BY workers.sirius_id";