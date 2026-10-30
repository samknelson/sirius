import { sql } from "drizzle-orm";
import { getClient, runInTransaction } from "../transaction-context";

/**
 * Ledger uses core tables, not a managesSchema manifest. Share this installer
 * between its upgrade migration, post-bootstrap bring-up and enable path.
 * No session flag, role exception, or migration escape hatch.
 */
export const LEDGER_IDENTITY_PROTECTION_SQL = `
DO $install$
BEGIN
  PERFORM pg_advisory_xact_lock(1890321, 801);
  IF to_regclass('public.ledger_ea') IS NOT NULL THEN
    LOCK TABLE public.ledger_ea IN SHARE ROW EXCLUSIVE MODE;
    CREATE OR REPLACE FUNCTION public.enforce_ledger_ea_identity()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF ROW(NEW.entity_type, NEW.entity_id, NEW.account_id)
         IS DISTINCT FROM ROW(OLD.entity_type, OLD.entity_id, OLD.account_id) THEN
        RAISE EXCEPTION 'Entity account identity is permanent after creation'
          USING ERRCODE = '23514', CONSTRAINT = 'ledger_ea_identity_immutable';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS ledger_ea_identity_immutable ON public.ledger_ea;
    CREATE TRIGGER ledger_ea_identity_immutable BEFORE UPDATE ON public.ledger_ea
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ledger_ea_identity();
    ALTER TABLE public.ledger_ea ENABLE ALWAYS TRIGGER ledger_ea_identity_immutable;
  END IF;
  IF to_regclass('public.ledger_accounts') IS NOT NULL THEN
    LOCK TABLE public.ledger_accounts IN SHARE ROW EXCLUSIVE MODE;
    CREATE OR REPLACE FUNCTION public.enforce_ledger_account_currency()
    RETURNS trigger LANGUAGE plpgsql AS $fn$
    BEGIN
      IF NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
        RAISE EXCEPTION 'Account currency is permanent after creation'
          USING ERRCODE = '23514', CONSTRAINT = 'ledger_accounts_currency_immutable';
      END IF;
      RETURN NEW;
    END
    $fn$;
    DROP TRIGGER IF EXISTS ledger_accounts_currency_immutable ON public.ledger_accounts;
    CREATE TRIGGER ledger_accounts_currency_immutable BEFORE UPDATE ON public.ledger_accounts
      FOR EACH ROW EXECUTE FUNCTION public.enforce_ledger_account_currency();
    ALTER TABLE public.ledger_accounts ENABLE ALWAYS TRIGGER ledger_accounts_currency_immutable;
  END IF;
END
$install$;
`;

export async function installLedgerIdentityProtection(): Promise<void> {
  await runInTransaction(async () => {
    // Bound lock waits, including the cross-process installer lock.
    await getClient().execute(sql`SET LOCAL lock_timeout = '15s'`);
    await getClient().execute(sql`SET LOCAL statement_timeout = '30s'`);
    await getClient().execute(sql.raw(LEDGER_IDENTITY_PROTECTION_SQL));
  });
}
