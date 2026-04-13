-- Migration: Add bulk campaign infrastructure
-- Adds bulk_campaign_status, bulk_campaign_audience_type enums
-- Adds bulk_campaigns table
-- Adds campaign_id FK column to bulk_messages
-- Expands bulk_message_status enum with processing/completed/failed/aborted

DO $$ BEGIN
  CREATE TYPE "bulk_campaign_status" AS ENUM ('draft', 'queued', 'processing', 'completed', 'failed', 'aborted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "bulk_campaign_audience_type" AS ENUM ('worker', 'employer_contact');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "bulk_campaigns" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" varchar NOT NULL,
  "status" "bulk_campaign_status" NOT NULL DEFAULT 'draft',
  "audience_type" "bulk_campaign_audience_type",
  "audience_filters" jsonb,
  "channels" text[] NOT NULL DEFAULT '{}'::text[],
  "scheduled_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "creator_user_id" varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "data" jsonb
);

DO $$ BEGIN
  ALTER TABLE "bulk_messages" ADD COLUMN "campaign_id" varchar REFERENCES "bulk_campaigns"("id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "bulk_message_status" ADD VALUE IF NOT EXISTS 'processing';
  ALTER TYPE "bulk_message_status" ADD VALUE IF NOT EXISTS 'completed';
  ALTER TYPE "bulk_message_status" ADD VALUE IF NOT EXISTS 'failed';
  ALTER TYPE "bulk_message_status" ADD VALUE IF NOT EXISTS 'aborted';
END $$;
