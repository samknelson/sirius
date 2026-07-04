import { runInTransaction } from "../../transaction-context";
import type { WorkerStorage } from "../../workers";
import type { BaoBeneficiaryList } from "../../../../shared/schema/sitespecific/bao/schema";
import type { StorageLoggingConfig } from "../../middleware/logging";

export interface BaoBeneficiariesStorage {
  get(workerId: string): Promise<BaoBeneficiaryList>;
  set(workerId: string, beneficiaries: BaoBeneficiaryList): Promise<BaoBeneficiaryList>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Owns the `data.sitespecific.bao.beneficiaries` JSON path on a worker. Reads
 * and writes go through the generic, beneficiary-agnostic
 * `workers.getData`/`workers.setData` accessors; the read-modify-write runs
 * inside a transaction so the merge that preserves every other key under
 * `data`, `data.sitespecific`, and `data.sitespecific.bao` is atomic.
 */
export function createBaoBeneficiariesStorage(
  workersStorage: WorkerStorage,
): BaoBeneficiariesStorage {
  function extractBeneficiaries(data: Record<string, unknown>): BaoBeneficiaryList {
    const sitespecific = isPlainObject(data.sitespecific) ? data.sitespecific : undefined;
    const bao = sitespecific && isPlainObject(sitespecific.bao) ? sitespecific.bao : undefined;
    const list = bao?.beneficiaries;
    return Array.isArray(list) ? (list as BaoBeneficiaryList) : [];
  }

  return {
    async get(workerId: string): Promise<BaoBeneficiaryList> {
      const data = await workersStorage.getData(workerId);
      return extractBeneficiaries(data);
    },

    async set(
      workerId: string,
      beneficiaries: BaoBeneficiaryList,
    ): Promise<BaoBeneficiaryList> {
      return runInTransaction(async () => {
        const data = await workersStorage.getData(workerId);

        const sitespecific = isPlainObject(data.sitespecific)
          ? { ...data.sitespecific }
          : {};
        const bao = isPlainObject(sitespecific.bao) ? { ...sitespecific.bao } : {};

        bao.beneficiaries = beneficiaries;
        sitespecific.bao = bao;

        const nextData: Record<string, unknown> = { ...data, sitespecific };

        await workersStorage.setData(workerId, nextData);
        return beneficiaries;
      });
    },
  };
}

export const baoBeneficiariesLoggingConfig: StorageLoggingConfig<BaoBeneficiariesStorage> = {
  module: "sitespecific.bao.beneficiaries",
  methods: {
    set: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: (args) =>
        `Updated beneficiaries (${Array.isArray(args[1]) ? args[1].length : 0} total)`,
    },
  },
};
