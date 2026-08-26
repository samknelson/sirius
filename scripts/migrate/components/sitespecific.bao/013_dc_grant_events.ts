import { db } from "../../../../server/db";
import { sql } from "drizzle-orm";
import { registerComponentMigration, type Migration } from "../../../../server/services/migration-runner";

const COMPONENT_ID = "sitespecific.bao";

/**
 * Disability Credit grant/reconcile lifecycle events.
 *
 * The DC approval cascade grants fund-attributed hours per selected work
 * month (or queues future months), releases queued months as their coverage
 * month enters the current+1 window, and reconciles granted hours downward as
 * later employer reporting arrives. Each of those transitions records a typed
 * row in sitespecific_bao_dc_events — this migration widens the event-type
 * CHECK to admit the four new lifecycle kinds:
 *
 *   case_month_granted     — positive DC shortfall hours written
 *   case_month_queued      — month deferred (coverage month beyond current+1)
 *   case_month_released    — queued month entered the window and was granted
 *   case_month_reconciled  — DC hours reduced to a new (smaller) shortfall
 *
 * Month statuses (selected/queued/granted/removed) already exist in 012 — no
 * change needed there. Idempotent: drop-and-recreate of a named constraint.
 */
const migration: Migration = {
  version: 13,
  name: "dc_grant_events",
  description:
    "Widen the DC event-type CHECK for grant/queue/release/reconcile lifecycle events",

  async up() {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        ALTER TABLE sitespecific_bao_dc_events
        DROP CONSTRAINT IF EXISTS sitespecific_bao_dc_events_event_type_check
      `);
      await tx.execute(sql`
        ALTER TABLE sitespecific_bao_dc_events
        ADD CONSTRAINT sitespecific_bao_dc_events_event_type_check
        CHECK (event_type IN ('case_opened', 'case_closed', 'case_voided', 'case_month_added', 'case_month_voided', 'denial_letter_recorded', 'denial_letter_voided', 'case_status_changed', 'document_uploaded', 'document_superseded', 'attestations_updated', 'case_month_granted', 'case_month_queued', 'case_month_released', 'case_month_reconciled'))
      `);
    });
  },
};

registerComponentMigration(COMPONENT_ID, migration);
export default migration;
