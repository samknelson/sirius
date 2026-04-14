-- Migration: Ledger accounting overhaul - statement_ymd
-- Task #16: Replace statement_month/statement_year with statement_ymd
--
-- This migration:
-- 1. Adds statement_ymd (date) column to ledger table
-- 2. Backfills statement_ymd from the existing date column
-- 3. Makes statement_ymd NOT NULL after backfill
-- 4. Removes statement_month and statement_year from ledger_payments
-- 5. Drops ledger_payment_allocations table

-- Step 1: Add statement_ymd column (nullable initially for backfill)
ALTER TABLE ledger ADD COLUMN IF NOT EXISTS statement_ymd date;

-- Step 2: Backfill statement_ymd from the entry's creation date
UPDATE ledger SET statement_ymd = date::date WHERE statement_ymd IS NULL;

-- Step 3: Make statement_ymd NOT NULL now that all rows are backfilled
ALTER TABLE ledger ALTER COLUMN statement_ymd SET NOT NULL;

-- Step 4: Remove old statement period columns from ledger_payments
ALTER TABLE ledger_payments DROP COLUMN IF EXISTS statement_month;
ALTER TABLE ledger_payments DROP COLUMN IF EXISTS statement_year;

-- Step 5: Drop the ledger_payment_allocations table
DROP TABLE IF EXISTS ledger_payment_allocations;
