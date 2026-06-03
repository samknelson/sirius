/**
 * Per-policy Event Center Hours Purchase (ECHP) pricing configuration storage.
 *
 * The configuration lives on the policy's `data` jsonb at
 * `data.sitespecific.bao.echp`. This module composes the generic
 * `policies.getData` / `policies.setData` accessors so all SQL stays in the
 * policy storage layer. The merge is done inside a transaction so concurrent
 * writers cannot clobber each other's unrelated `data` keys.
 *
 * Because `set` calls `policies.setData`, BOTH this module's mutation and the
 * underlying policy `setData` are logged with the policy as the host entity.
 */

import { runInTransaction } from "../../transaction-context";
import type { PolicyStorage } from "../../policies";
import type { StorageLoggingConfig } from "../../middleware/logging";
import {
  baoEchpConfigSchema,
  type BaoEchpConfig,
} from "../../../../shared/schema/sitespecific/bao/schema";

const EMPTY_CONFIG: BaoEchpConfig = { enabled: false, breakpoints: [] };

export interface BaoEchpConfigStorage {
  get(policyId: string): Promise<BaoEchpConfig>;
  set(policyId: string, config: BaoEchpConfig): Promise<BaoEchpConfig>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function extractConfig(data: Record<string, unknown>): BaoEchpConfig {
  const sitespecific = isPlainObject(data.sitespecific)
    ? data.sitespecific
    : undefined;
  const bao =
    sitespecific && isPlainObject(sitespecific.bao)
      ? sitespecific.bao
      : undefined;
  const parsed = baoEchpConfigSchema.safeParse(bao?.echp);
  return parsed.success ? parsed.data : { ...EMPTY_CONFIG };
}

export function createBaoEchpConfigStorage(
  policiesStorage: PolicyStorage,
): BaoEchpConfigStorage {
  return {
    async get(policyId: string): Promise<BaoEchpConfig> {
      const data = await policiesStorage.getData(policyId);
      return extractConfig(data);
    },

    async set(policyId: string, config: BaoEchpConfig): Promise<BaoEchpConfig> {
      return runInTransaction(async () => {
        const data = await policiesStorage.getData(policyId);
        const sitespecific = isPlainObject(data.sitespecific)
          ? { ...data.sitespecific }
          : {};
        const bao = isPlainObject(sitespecific.bao) ? { ...sitespecific.bao } : {};
        bao.echp = config;
        sitespecific.bao = bao;
        const nextData = { ...data, sitespecific };
        await policiesStorage.setData(policyId, nextData);
        return config;
      });
    },
  };
}

export const baoEchpConfigLoggingConfig: StorageLoggingConfig<BaoEchpConfigStorage> = {
  module: "sitespecific.bao.echp",
  methods: {
    set: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: (args) => args[0],
      getDescription: (args) => {
        const cfg = args[1] as BaoEchpConfig | undefined;
        const count = cfg?.breakpoints?.length ?? 0;
        const state = cfg?.enabled ? "enabled" : "disabled";
        return `Updated ECHP pricing config (${state}, ${count} breakpoint${count === 1 ? "" : "s"})`;
      },
    },
  },
};
