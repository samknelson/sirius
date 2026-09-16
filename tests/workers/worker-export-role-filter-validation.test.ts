import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/component-cache", () => ({
  isCacheInitialized: () => true,
  isComponentEnabledSync: () => true,
}));

import { registerWorkerExportRoute } from "../../server/modules/workers/export";

describe("worker export role-filter validation", () => {
  it("returns 400 before export metadata, headers, or batches are touched", async () => {
    let handler:
      | ((request: any, response: any) => Promise<void>)
      | undefined;
    const app = {
      get: vi.fn((_path: string, ...handlers: Array<unknown>) => {
        handler = handlers[handlers.length - 1] as typeof handler;
      }),
    };
    const getBatch = vi.fn();
    const getShowOnListsIdTypes = vi.fn();
    const getMemberStatusOptions = vi.fn();

    registerWorkerExportRoute(
      app as any,
      ((_request: any, _response: any, next: () => void) => next()) as any,
      () => ((_request: any, _response: any, next: () => void) => next()) as any,
      {
        workers: { getWorkersForExportBatch: getBatch as any },
        workerIds: {
          getShowOnListsIdTypes,
          getWorkerIdsForListByWorkerIds: vi.fn(),
        },
        employers: { getByIds: vi.fn() },
        getMemberStatusOptions,
      },
    );

    let statusCode = 200;
    const responseBody: Record<string, unknown> = {};
    const response = {
      writableEnded: false,
      destroyed: false,
      headersSent: false,
      once: vi.fn(),
      removeListener: vi.fn(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      status: vi.fn((code: number) => {
        statusCode = code;
        return response;
      }),
      json: vi.fn((body: Record<string, unknown>) => {
        Object.assign(responseBody, body);
        return response;
      }),
    };

    await handler!(
      { query: { dependentSinceFrom: "2024-13" } },
      response,
    );

    expect(statusCode).toBe(400);
    expect(responseBody.message).toEqual(
      "dependentSinceFrom must be a valid YYYY-MM value",
    );
    expect(response.setHeader).not.toHaveBeenCalled();
    expect(response.flushHeaders).not.toHaveBeenCalled();
    expect(getShowOnListsIdTypes).not.toHaveBeenCalled();
    expect(getMemberStatusOptions).not.toHaveBeenCalled();
    expect(getBatch).not.toHaveBeenCalled();
  });
});