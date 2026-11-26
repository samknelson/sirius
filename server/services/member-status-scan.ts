import { storage } from "../storage";
import { toChargeConfig } from "../plugins/ledger/charge/charge-config-resolution";
import { logger } from "../logger";

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
  const statuses = await storage.memberStatusScan.getStatusDefinitions();
  const map = new Map<string, { id: string; code: string }>();
  for (const row of statuses) {
    map.set(row.code, { id: row.id, code: row.code });
  }
  return map;
}

async function getIndustryId(): Promise<string | null> {
  return storage.memberStatusScan.getIndustryId();
}

async function getDuesAccountId(): Promise<string | null> {
  // Charge configs now live in the unified plugin_configs tables; resolve the
  // first enabled 'btu-dues-allocation' config via the storage layer.
  const configs = (await storage.pluginConfigs.search("charge", {
    pluginId: 'btu-dues-allocation',
    enabled: true,
  })).map(toChargeConfig);
  if (configs.length === 0) return null;
  const settings = configs[0].settings as { accountIds?: string[] } | null;
  return settings?.accountIds?.[0] || null;
}

async function getDelinquentDaysForBu(bargainingUnitId: string | null): Promise<number> {
  if (!bargainingUnitId) return DEFAULT_DELINQUENT_DAYS;
  const bu = await storage.bargainingUnits.getBargainingUnitById(bargainingUnitId);
  if (!bu) return DEFAULT_DELINQUENT_DAYS;
  const buData = bu.data as { memberStatusDelinquentDays?: number } | null;
  return buData?.memberStatusDelinquentDays || DEFAULT_DELINQUENT_DAYS;
}

async function getCurrentMemberStatusCode(workerId: string, industryId: string, statusMap: Map<string, { id: string; code: string }>): Promise<string | null> {
  const current = await storage.memberStatusScan.getCurrentStatus(workerId, industryId);
  if (!current) return null;
  const msId = current.ms_id;
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

  const worker = await storage.memberStatusScan.getWorker(workerId);
  if (!worker) throw new Error(`Worker ${workerId} not found`);

  const previousCode = await getCurrentMemberStatusCode(workerId, industryId, statusMap);

  const hasSignedCardCheck = await storage.memberStatusScan.hasSignedCard(workerId);

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
      const latestPayment = await storage.memberStatusScan.getLatestPayment(ea.id);
      if (!latestPayment) {
        newCode = "pend";
      } else {
        const lastPaymentDateStr = String(latestPayment.date).split("T")[0];
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
      const existingToday = await storage.memberStatusScan.getHistoryOnDate(workerId, industryId, today);
      if (existingToday) {
        const existingId = existingToday.id;
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

  const workerRows = await storage.memberStatusScan.getActiveWorkers();
  logger.info(`Member status scan: found ${workerRows.length} active workers`, {
    service: "member-status-scan",
    mode,
  });

  const buDelinquentDaysCache = new Map<string, number>();

  const signedCardWorkers = new Set(await storage.memberStatusScan.getSignedCardWorkerIds());

  let eaMap = new Map<string, string>();
  if (duesAccountId) {
    const eaResult = await storage.memberStatusScan.getWorkerLedgerAccounts(duesAccountId);
    for (const row of eaResult) {
      eaMap.set(row.entity_id, row.id);
    }
  }

  let latestPaymentMap = new Map<string, Date>();
  if (duesAccountId && eaMap.size > 0) {
    const paymentResult = await storage.memberStatusScan.getLatestPayments(Array.from(eaMap.values()));
    for (const row of paymentResult) {
      const workerId = [...eaMap.entries()].find(([, eaId]) => eaId === row.ea_id)?.[0];
      if (workerId) {
        latestPaymentMap.set(workerId, new Date(row.date));
      }
    }
  }

  const currentStatusMap = new Map<string, string | null>();
  const mshResult = await storage.memberStatusScan.getCurrentStatuses(industryId);
  for (const row of mshResult) {
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
