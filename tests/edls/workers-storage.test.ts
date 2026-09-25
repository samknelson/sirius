import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("../../server/storage/transaction-context", () => ({
  getClient: mocks.getClient,
}));

const { createWorkerEdlsStorage } = await import("../../server/storage/edls/workers");

describe("EDLS worker storage", () => {
  afterEach(() => {
    mocks.getClient.mockReset();
  });

  it("counts only crew-backed assignment rows as EDLS presence", async () => {
    let statement = "";
    const execute = vi.fn(async (query) => {
      statement = new PgDialect().sqlToQuery(query as never).sql;
      return { rows: [{ present: true }] };
    });
    mocks.getClient.mockReturnValue({ execute });

    const present = await createWorkerEdlsStorage().hasEdlsPresence("worker-1");

    expect(present).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(statement.toLowerCase()).toContain("ea.crew_id is not null");
  });
});