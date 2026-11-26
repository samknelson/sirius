import { and, eq, sql } from "drizzle-orm";
import { workers } from "@shared/schema";
import { cardchecks } from "@shared/schema/cardcheck/schema";
import { getClient } from "./transaction-context";

/** Read projections for the cross-domain member-status scan; decisions stay in the service. */
export interface MemberStatusScanStorage {
  getStatusDefinitions(): Promise<Array<{ id: string; code: string }>>;
  getIndustryId(): Promise<string | null>;
  getWorker(workerId: string): Promise<{ id: string; bargainingUnitId: string | null } | undefined>;
  getCurrentStatus(workerId: string, industryId: string): Promise<{ ms_id: string } | undefined>;
  hasSignedCard(workerId: string): Promise<boolean>;
  getLatestPayment(eaId: string): Promise<{ date: string | Date } | undefined>;
  getHistoryOnDate(workerId: string, industryId: string, date: string): Promise<{ id: string } | undefined>;
  getActiveWorkers(): Promise<Array<{ id: string; bargaining_unit_id: string | null }>>;
  getSignedCardWorkerIds(): Promise<string[]>;
  getWorkerLedgerAccounts(accountId: string): Promise<Array<{ id: string; entity_id: string }>>;
  getLatestPayments(eaIds: string[]): Promise<Array<{ ea_id: string; date: string | Date }>>;
  getCurrentStatuses(industryId: string): Promise<Array<{ worker_id: string; ms_id: string }>>;
}

export function createMemberStatusScanStorage(): MemberStatusScanStorage {
  return {
    async getStatusDefinitions() {
      const result = await getClient().execute<{ id: string; code: string }>(sql`
        SELECT id, code FROM options_worker_ms
        WHERE code IN ('paid', 'pend', 'delinquent', 'non')
      `);
      return result.rows;
    },

    async getIndustryId() {
      const result = await getClient().execute<{ industry_id: string | null }>(sql`
        SELECT DISTINCT industry_id FROM options_worker_ms WHERE code IN ('paid', 'pend', 'delinquent', 'non') LIMIT 1
      `);
      return result.rows[0]?.industry_id || null;
    },

    async getWorker(workerId) {
      const [worker] = await getClient()
        .select({ id: workers.id, bargainingUnitId: workers.bargainingUnitId })
        .from(workers)
        .where(eq(workers.id, workerId));
      return worker;
    },

    async getCurrentStatus(workerId, industryId) {
      // Date alone settles which entry is current: unique (worker_id,
      // industry_id, date) allows only one entry per day; id keeps ordering total.
      const result = await getClient().execute<{ ms_id: string }>(sql`
        SELECT ms_id FROM worker_msh
        WHERE worker_id = ${workerId} AND industry_id = ${industryId}
        ORDER BY date DESC, id DESC
        LIMIT 1
      `);
      return result.rows[0];
    },

    async hasSignedCard(workerId) {
      const rows = await getClient()
        .select({ id: cardchecks.id })
        .from(cardchecks)
        .where(and(eq(cardchecks.workerId, workerId), eq(cardchecks.status, "signed")))
        .limit(1);
      return rows.length > 0;
    },

    async getLatestPayment(eaId) {
      const result = await getClient().execute<{ date: string | Date }>(sql`
        SELECT date FROM ledger WHERE ea_id = ${eaId} ORDER BY date DESC LIMIT 1
      `);
      // Leave the driver's date representation untouched: single and bulk scans
      // deliberately interpret it differently.
      return result.rows[0];
    },

    async getHistoryOnDate(workerId, industryId, date) {
      const result = await getClient().execute<{ id: string }>(sql`
        SELECT id FROM worker_msh
        WHERE worker_id = ${workerId} AND industry_id = ${industryId} AND date = ${date}
        LIMIT 1
      `);
      return result.rows[0];
    },

    async getActiveWorkers() {
      const result = await getClient().execute<{ id: string; bargaining_unit_id: string | null }>(sql`
        SELECT DISTINCT ON (w.id) w.id, w.bargaining_unit_id
        FROM workers w
        INNER JOIN (
          SELECT DISTINCT ON (wh.worker_id) wh.worker_id, wh.employment_status_id
          FROM worker_hours wh
          ORDER BY wh.worker_id, wh.year DESC, wh.month DESC, wh.day DESC
        ) latest ON latest.worker_id = w.id
        INNER JOIN options_employment_status es ON es.id = latest.employment_status_id
        WHERE es.employed = true
      `);
      return result.rows;
    },

    async getSignedCardWorkerIds() {
      const result = await getClient().execute<{ worker_id: string }>(sql`
        SELECT DISTINCT worker_id FROM cardchecks WHERE status = 'signed'
      `);
      return result.rows.map(row => row.worker_id);
    },

    async getWorkerLedgerAccounts(accountId) {
      const result = await getClient().execute<{ id: string; entity_id: string }>(sql`
        SELECT id, entity_id FROM ledger_ea
        WHERE entity_type = 'worker' AND account_id = ${accountId}
      `);
      return result.rows;
    },

    async getLatestPayments(eaIds) {
      if (eaIds.length === 0) return [];
      const result = await getClient().execute<{ ea_id: string; date: string | Date }>(sql`
        SELECT DISTINCT ON (ea_id) ea_id, date
        FROM ledger
        WHERE ea_id = ANY(${sql`ARRAY[${sql.join(eaIds.map(id => sql`${id}`), sql`, `)}]`}::varchar[])
        ORDER BY ea_id, date DESC
      `);
      return result.rows;
    },

    async getCurrentStatuses(industryId) {
      const result = await getClient().execute<{ worker_id: string; ms_id: string }>(sql`
        SELECT DISTINCT ON (worker_id) worker_id, ms_id
        FROM worker_msh
        WHERE industry_id = ${industryId}
        ORDER BY worker_id, date DESC, id DESC
      `);
      return result.rows;
    },
  };
}
