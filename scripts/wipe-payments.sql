-- WIPE ALL PAYMENTS SCRIPT
-- This script removes all payment records and their associated ledger entries.
-- It is DESTRUCTIVE and IRREVERSIBLE. Run against production with extreme caution.
--
-- Order of operations:
--   1. Delete ledger entries that reference payments (reference_type = 'payment')
--   2. Delete all payment records from ledger_payments
--
-- Run inside a transaction so you can review counts before committing.

BEGIN;

-- Step 1: Delete ledger entries tied to payments
DELETE FROM ledger
WHERE reference_type = 'payment';

-- Step 2: Delete all payment records
DELETE FROM ledger_payments;

-- Review what was deleted before committing:
-- SELECT count(*) FROM ledger WHERE reference_type = 'payment';   -- should be 0
-- SELECT count(*) FROM ledger_payments;                            -- should be 0

COMMIT;
