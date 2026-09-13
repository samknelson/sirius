import { getTableConfig } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wcStats } from "@shared/schema";

let write: { values?: unknown; conflict?: any } = {};
let serviceTypeRows: Array<{ service: string; requestType: string; calls: number }> = [];
let dayRows: Array<{ ymd: string; calls: number }> = [];
let dimensionRows: Array<Record<string, unknown>> = [];

function stubClient() {
  const chain: any = {};
  let read: "days" | "serviceTypes" | "dimensions" = "serviceTypes";
  chain.select = (fields: Record<string, unknown>) => {
    read =
      "configurationId" in fields
        ? "dimensions"
        : "ymd" in fields
          ? "days"
          : "serviceTypes";
    return chain;
  };
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => chain;
  chain.orderBy = () =>
    Promise.resolve(
      read === "days"
        ? dayRows
        : read === "dimensions"
          ? dimensionRows
          : serviceTypeRows,
    );
  chain.insert = () => ({
    values: (values: unknown) => {
      write.values = values;
      return {
        onConflictDoUpdate: (conflict: unknown) => {
          write.conflict = conflict;
          return Promise.resolve();
        },
      };
    },
  });
  return chain;
}

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: () => stubClient(),
}));

const { createWcStatsStorage } = await import("../../server/storage/wc-stats");
const storage = createWcStatsStorage();
const RANGE = { start: "2026-09-01" as const, end: "2026-09-13" as const };

beforeEach(() => {
  write = {};
  serviceTypeRows = [];
  dayRows = [];
  dimensionRows = [];
});

describe("outgoing call attribution", () => {
  it("writes the resolved configuration in the atomic counter tuple", async () => {
    await storage.recordCall("lob", "verify_address", "2026-09-13", "cfg-lob");

    expect(write.values).toMatchObject({
      service: "lob",
      requestType: "verify_address",
      ymd: "2026-09-13",
      calls: 1,
    });
    expect((write.values as { configurationId: unknown }).configurationId).toHaveProperty(
      "queryChunks",
    );
    expect(write.conflict.target).toEqual([
      wcStats.service,
      wcStats.requestType,
      wcStats.configurationId,
      wcStats.ymd,
    ]);
  });

  it("keeps legacy direct transports in one nullable attribution bucket", async () => {
    await storage.recordCall("legacy", "lookup", "2026-09-13");
    expect(write.values).toMatchObject({ configurationId: null });

    const { uniqueConstraints } = getTableConfig(wcStats);
    expect(uniqueConstraints).toHaveLength(1);
    expect(uniqueConstraints[0]).toMatchObject({
      name: "wc_stats_service_type_configuration_ymd_uniq",
      nullsNotDistinct: true,
    });
    expect(uniqueConstraints[0].columns.map((column) => column.name)).toEqual([
      "service",
      "request_type",
      "configuration_id",
      "ymd",
    ]);
  });

  it("preserves cross-configuration totals for coarse consumers", async () => {
    serviceTypeRows = [
      { service: "lob", requestType: "verify_address", calls: 3 },
      { service: "lob", requestType: "send_letter", calls: 4 },
      { service: "twilio", requestType: "lookup", calls: 2 },
    ];

    await expect(storage.countsByService(RANGE)).resolves.toEqual([
      { service: "lob", calls: 7 },
      { service: "twilio", calls: 2 },
    ]);
  });

  it("exposes current labels and nullable historical attribution", async () => {
    dimensionRows = [
      {
        service: "lob",
        requestType: "verify_address",
        configurationId: null,
        configurationName: null,
        pluginId: null,
      },
      {
        service: "lob",
        requestType: "verify_address",
        configurationId: "cfg-lob",
        configurationName: "Production mail",
        pluginId: "lob",
      },
    ];

    await expect(storage.listDimensions()).resolves.toEqual(dimensionRows);
  });
});