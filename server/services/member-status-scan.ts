import { storage } from "../storage";
import { logger } from "../logger";
import { getClient } from "../storage/transaction-context";
import { sql, eq, and, desc } from "drizzle-orm";
import { cardchecks } from "@shared/schema/cardcheck/schema";
import { workers, ledger, ledgerEa, bargainingUnits } from "@shared/schema";

const DEFAULT_DELINQUENT_DAYS = 60;

interface ScanResult {
  workerId: string;
  previousStatusCode: string | null;
  newStatusCode: string;
  changed: boolean;
}

interface BulkScanResult {
  totalScanned: number;
  changed: number;
  unchanged: number;
  errors: number;
  details: {
    toMember: number;
    toPending: number;
    toDelinquent: number;
    toNonMember: number;
  };
}

async function getMemberStatusMap(): Promise<Map<string, { id: string; code: string }>> {
  const client = getClient();
  const statuses = await client.execute(sql`
    SELECT id, code FROM options_worker_ms
    WHERE code IN ('paid', 'pend', 'delinquent', 'non')
  `);
  const map = new Map<string, { id: string; code: string }>();
  for (const row of statuses.rows as any[]) {
    map.set(row.code, { id: row.id, code: row.code });
  }
  return map;
}

async function getIndustryId(): Promise<string | null> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT DISTINCT industry_id FROM options_worker_ms WHERE code IN ('paid', 'pend', 'delinquent', 'non') LIMIT 1
  `);
  return (result.rows[0] as any)?.industry_id || null;
}

async function getDuesAccountId(): Promise<string | null> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT settings FROM charge_plugin_configs WHERE plugin_id = 'btu-dues-allocation' AND enabled = true LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  const settings = (result.rows[0] as any).settings as { accountIds?: string[] } | null;
  return settings?.accountIds?.[0] || null;
}

async function getDelinquentDaysForBu(bargainingUnitId: string | null): Promise<number> {
  if (!bargainingUnitId) return DEFAULT_DELINQUENT_DAYS;
  const client = getClient();
  const [bu] = await client
    .select({ data: bargainingUnits.data })
    .from(bargainingUnits)
    .where(eq(bargainingUnits.id, bargainingUnitId));
  if (!bu) return DEFAULT_DELINQUENT_DAYS;
  const buData = bu.data as { memberStatusDelinquentDays?: number } | null;
  return buData?.memberStatusDelinquentDays || DEFAULT_DELINQUENT_DAYS;
}

async function getCurrentMemberStatusCode(workerId: string, industryId: string, statusMap: Map<string, { id: string; code: string }>): Promise<string | null> {
  const client = getClient();
  const result = await client.execute(sql`
    SELECT ms_id FROM worker_msh
    WHERE worker_id = ${workerId} AND industry_id = ${industryId}
    ORDER BY date DESC, created_at DESC NULLS LAST, id DESC
    LIMIT 1
  `);
  if (result.rows.length === 0) return null;
  const msId = (result.rows[0] as any).ms_id;
  for (const [code, status] of statusMap) {
    if (status.id === msId) return code;
  }
  return null;
}

export async function scanWorkerMemberStatus(workerId: string): Promise<ScanResult> {
  const statusMap = await getMemberStatusMap();
  const industryId = await getIndustryId();
  const duesAccountId = await getDuesAccountId();

  if (!industryId || statusMap.size < 4) {
    throw new Error("Member status configuration incomplete: missing industry or status definitions");
  }

  const client = getClient();

  const [worker] = await client
    .select({ id: workers.id, bargainingUnitId: workers.bargainingUnitId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) throw new Error(`Worker ${workerId} not found`);

  const previousCode = await getCurrentMemberStatusCode(workerId, industryId, statusMap);

  const signedCards = await client
    .select({ id: cardchecks.id })
    .from(cardchecks)
    .where(and(eq(cardchecks.workerId, workerId), eq(cardchecks.status, "signed")))
    .limit(1);

  const hasSignedCardCheck = signedCards.length > 0;

  let newCode: string;

  if (!hasSignedCardCheck) {
    newCode = "non";
  } else if (!duesAccountId) {
    newCode = "pend";
  } else {
    const ea = await storage.ledger.ea.getByEntityAndAccount("worker", workerId, duesAccountId);
    if (!ea) {
      newCode = "pend";
    } else {
      const latestPayment = await client.execute(sql`
        SELECT date FROM ledger WHERE ea_id = ${ea.id} ORDER BY date DESC LIMIT 1
      `);
      if (latestPayment.rows.length === 0) {
        newCode = "pend";
      } else {
        const lastPaymentDateStr = String((latestPayment.rows[0] as any).date).split("T")[0];
        const delinquentDays = await getDelinquentDaysForBu(worker.bargainingUnitId);
        const today = new Date();
        const cutoffDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - delinquentDays));
        const cutoffStr = cutoffDate.toISOString().split("T")[0];
        newCode = lastPaymentDateStr >= cutoffStr ? "paid" : "delinquent";
      }
    }
  }

  const changed = previousCode !== newCode;

  if (changed) {
    const newStatus = statusMap.get(newCode);
    if (newStatus) {
      const today = new Date().toISOString().split("T")[0];
      const existingToday = await client.execute(sql`
        SELECT id FROM worker_msh
        WHERE worker_id = ${workerId} AND industry_id = ${industryId} AND date = ${today}
        LIMIT 1
      `);
      if (existingToday.rows.length > 0) {
        const existingId = (existingToday.rows[0] as any).id;
        await storage.workerMsh.updateWorkerMsh(existingId, {
          msId: newStatus.id,
          data: { source: "auto-scan" },
        });
      } else {
        await storage.workerMsh.createWorkerMsh({
          workerId,
          date: today,
          msId: newStatus.id,
          industryId,
          data: { source: "auto-scan" },
        });
      }
      logger.info("Member status updated by scan", {
        service: "member-status-scan",
        workerId,
        previousCode,
        newCode,
      });
    }
  }

  return { workerId, previousStatusCode: previousCode, newStatusCode: newCode, changed };
}

export async function scanAllWorkers(mode: "live" | "test"): Promise<BulkScanResult> {
  const statusMap = await getMemberStatusMap();
  const industryId = await getIndustryId();
  const duesAccountId = await getDuesAccountId();

  if (!industryId || statusMap.size < 4) {
    throw new Error("Member status configuration incomplete: missing industry or status definitions");
  }

  const client = getClient();

  const activeWorkers = await client.execute(sql`
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

  const workerRows = activeWorkers.rows as any[];
  logger.info(`Member status scan: found ${workerRows.length} active workers`, {
    service: "member-status-scan",
    mode,
  });

  const buDelinquentDaysCache = new Map<string, number>();

  const signedCardWorkers = new Set<string>();
  const signedResult = await client.execute(sql`
    SELECT DISTINCT worker_id FROM cardchecks WHERE status = 'signed'
  `);
  for (const row of signedResult.rows as any[]) {
    signedCardWorkers.add(row.worker_id);
  }

  let eaMap = new Map<string, string>();
  if (duesAccountId) {
    const eaResult = await client.execute(sql`
      SELECT id, entity_id FROM ledger_ea
      WHERE entity_type = 'worker' AND account_id = ${duesAccountId}
    `);
    for (const row of eaResult.rows as any[]) {
      eaMap.set(row.entity_id, row.id);
    }
  }

  let latestPaymentMap = new Map<string, Date>();
  if (duesAccountId && eaMap.size > 0) {
    const paymentResult = await client.execute(sql`
      SELECT DISTINCT ON (ea_id) ea_id, date
      FROM ledger
      WHERE ea_id = ANY(${sql`ARRAY[${sql.join(Array.from(eaMap.values()).map(id => sql`${id}`), sql`, `)}]`}::varchar[])
      ORDER BY ea_id, date DESC
    `);
    for (const row of paymentResult.rows as any[]) {
      const workerId = [...eaMap.entries()].find(([, eaId]) => eaId === row.ea_id)?.[0];
      if (workerId) {
        latestPaymentMap.set(workerId, new Date(row.date));
      }
    }
  }

  const currentStatusMap = new Map<string, string | null>();
  const mshResult = await client.execute(sql`
    SELECT DISTINCT ON (worker_id) worker_id, ms_id
    FROM worker_msh
    WHERE industry_id = ${industryId}
    ORDER BY worker_id, date DESC, created_at DESC NULLS LAST, id DESC
  `);
  for (const row of mshResult.rows as any[]) {
    const code = [...statusMap.entries()].find(([, s]) => s.id === row.ms_id)?.[0] || null;
    currentStatusMap.set(row.worker_id, code);
  }

  const result: BulkScanResult = {
    totalScanned: workerRows.length,
    changed: 0,
    unchanged: 0,
    errors: 0,
    details: { toMember: 0, toPending: 0, toDelinquent: 0, toNonMember: 0 },
  };

  const cutoffDate = new Date();
  const today = new Date().toISOString().split("T")[0];

  for (const workerRow of workerRows) {
    try {
      const wId = workerRow.id;
      const buId = workerRow.bargaining_unit_id;
      const hasSignedCard = signedCardWorkers.has(wId);
      const previousCode = currentStatusMap.get(wId) || null;

      let newCode: string;
      if (!hasSignedCard) {
        newCode = "non";
      } else if (!duesAccountId) {
        newCode = "pend";
      } else {
        const lastPayment = latestPaymentMap.get(wId);
        if (!lastPayment) {
          newCode = "pend";
        } else {
          let delinquentDays: number;
          if (buId && buDelinquentDaysCache.has(buId)) {
            delinquentDays = buDelinquentDaysCache.get(buId)!;
          } else if (buId) {
            delinquentDays = await getDelinquentDaysForBu(buId);
            buDelinquentDaysCache.set(buId, delinquentDays);
          } else {
            delinquentDays = DEFAULT_DELINQUENT_DAYS;
          }
          const buCutoff = new Date();
          buCutoff.setDate(buCutoff.getDate() - delinquentDays);
          newCode = lastPayment >= buCutoff ? "paid" : "delinquent";
        }
      }

      if (previousCode !== newCode) {
        if (mode === "live") {
          const newStatus = statusMap.get(newCode);
          if (newStatus) {
            await storage.workerMsh.createWorkerMsh({
              workerId: wId,
              date: today,
              msId: newStatus.id,
              industryId,
              data: { source: "auto-scan" },
            });
          }
        }
        result.changed++;
        if (newCode === "paid") result.details.toMember++;
        else if (newCode === "pend") result.details.toPending++;
        else if (newCode === "delinquent") result.details.toDelinquent++;
        else if (newCode === "non") result.details.toNonMember++;
      } else {
        result.unchanged++;
      }
    } catch (error) {
      result.errors++;
      logger.error("Error scanning worker member status", {
        service: "member-status-scan",
        workerId: workerRow.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("Member status scan completed", {
    service: "member-status-scan",
    mode,
    ...result,
  });

  return result;
}
