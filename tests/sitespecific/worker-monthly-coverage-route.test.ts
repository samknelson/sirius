import express from "express";
import type { Server } from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerWorkerMonthlyCoverageHistoryRoute } from "../../server/modules/workers/monthly-coverage-history";

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

describe("worker monthly coverage history route", () => {
  it("checks worker access before reading history and scopes the read to the requested worker", async () => {
    const app = express();
    const build = vi.fn().mockResolvedValue({ months: [], total: 0, showCharges: false, partial: false });
    registerWorkerMonthlyCoverageHistoryRoute(
      app,
      (req, res, next) => {
        if (req.params.workerId !== req.header("x-authorized-worker")) return res.sendStatus(403);
        next();
      },
      build,
    );
    server = await new Promise<Server>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind to a port");
    const base = `http://127.0.0.1:${address.port}/api/workers`;
    expect((await fetch(`${base}/someone-else/benefits/monthly-history`, {
      headers: { "x-authorized-worker": "selected" },
    })).status).toBe(403);
    expect(build).not.toHaveBeenCalled();
    expect((await fetch(`${base}/selected/benefits/monthly-history?limit=500`, {
      headers: { "x-authorized-worker": "selected" },
    })).status).toBe(400);
    const response = await fetch(`${base}/selected/benefits/monthly-history?offset=12&limit=12`, {
      headers: { "x-authorized-worker": "selected" },
    });
    expect(response.status).toBe(200);
    expect(build).toHaveBeenCalledExactlyOnceWith("selected", 12, 12);
  });
});