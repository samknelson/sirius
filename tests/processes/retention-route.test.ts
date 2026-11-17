import { expect, it, vi, beforeEach } from "vitest";
import express from "express";
import { once } from "node:events";
const fake = vi.hoisted(() => ({
  countExpired: vi.fn(), getExpiredIds: vi.fn(), deleteExpired: vi.fn(), getPage: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: { processes: fake } }));
vi.mock("../../server/plugins/system/data-retention/registry", () => ({ registerDataRetentionPlugin: vi.fn() }));
import { processesRetentionPlugin as plugin } from "../../server/plugins/system/data-retention/plugins/processes";
import { registerProcessRoutes } from "../../server/modules/system/processes";
beforeEach(() => vi.resetAllMocks());
it("uses a ten-day cutoff, caps dry-run work and rechecks each live deletion", async () => {
  fake.countExpired.mockResolvedValue(2000);
  const result = await plugin.cleanup("test");
  expect(result.count).toBe(1000);
  expect(fake.deleteExpired).not.toHaveBeenCalled();
  const cutoff = fake.countExpired.mock.calls[0][0];
  expect(Math.abs(Date.now() - cutoff.getTime() - 10 * 86400000)).toBeLessThan(1000);
  fake.getExpiredIds.mockResolvedValue(["old", "renewed"]);
  fake.deleteExpired.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await plugin.cleanup("live", { retentionDays: 2 })).count).toBe(1);
  expect(fake.getExpiredIds.mock.calls[0][1]).toBe(1000);
  expect(fake.deleteExpired.mock.calls.map(c => c[0])).toEqual(["old", "renewed"]);
  await expect(plugin.cleanup("live", { retentionDays: 0 })).rejects.toThrow();
});
it("requires the admin policy before reading and rejects invalid pagination", async () => {
  const app = express();
  registerProcessRoutes(app, policy => {
    expect(policy).toBe("admin");
    return (req, res, next) => {
      if (req.headers["x-test-admin"] !== "yes") { res.status(403).end(); return; }
      next();
    };
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/processes`;
  try {
    expect((await fetch(url)).status).toBe(403);
    expect(fake.getPage).not.toHaveBeenCalled();
    expect((await fetch(`${url}?pageSize=101`, { headers: { "x-test-admin": "yes" } })).status).toBe(400);
    fake.getPage.mockResolvedValue({ entries: [], total: 0 });
    const response = await fetch(`${url}?page=2&pageSize=10`, { headers: { "x-test-admin": "yes" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(fake.getPage).toHaveBeenCalledWith({ page: 2, pageSize: 10 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
