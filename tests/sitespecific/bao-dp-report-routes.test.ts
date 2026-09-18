import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const calculate = vi.fn(async () => ({
  asOfYmd: "2026-04-15", currentMonth: "2026-04", rows: [],
  totalActiveWorkers: 0, totalCharges: "0.00", totalPaid: "0.00", totalBalance: "0.00",
  statusCounts: { paid_covered: 0, partially_paid: 0, unpaid_not_covered: 0, confirmed_no_charge: 0, unavailable_not_covered: 0 },
}));
let componentEnabled = true;
vi.mock("../../server/services/sitespecific/bao/dp-reporting", () => ({
  calculateDpCurrentMonthReport: calculate,
  DP_REPORT_STATUSES: ["paid_covered", "partially_paid", "unpaid_not_covered", "confirmed_no_charge", "unavailable_not_covered"],
}));
vi.mock("../../server/modules/components", () => ({
  requireComponent: () => (_req: any, res: any, next: any) =>
    componentEnabled ? next() : res.status(403).json({ error: "component_disabled" }),
}));

let base = ""; let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const app = express();
  const auth: any = (req: any, res: any, next: any) => req.header("x-auth") === "yes" ? next() : res.status(401).json({ message: "auth required" });
  const access: any = (policy: string) => (req: any, res: any, next: any) =>
    policy === "staff" && req.header("x-staff") === "yes" ? next() : res.status(403).json({ message: "staff required" });
  const { registerBaoDpRoutes } = await import("../../server/modules/sitespecific/bao/dp");
  registerBaoDpRoutes(app, auth, () => () => undefined, access);
  const server = await new Promise<any>((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () => new Promise((resolve, reject) => server.close((e: Error | undefined) => e ? reject(e) : resolve()));
});
afterAll(async () => closeServer?.());

describe("BAO Domestic Partner report routes", () => {
  const headers = { "x-auth": "yes", "x-staff": "yes" };
  it("requires auth, staff, and enabled BAO component", async () => {
    expect((await fetch(`${base}/api/sitespecific/bao/dp-report/summary`)).status).toBe(401);
    expect((await fetch(`${base}/api/sitespecific/bao/dp-report/summary`, { headers: { "x-auth": "yes" } })).status).toBe(403);
    componentEnabled = false;
    expect((await fetch(`${base}/api/sitespecific/bao/dp-report/summary`, { headers })).status).toBe(403);
    componentEnabled = true;
  });
  it("rejects unknown status with 400 and does not leak calculation errors", async () => {
    expect((await fetch(`${base}/api/sitespecific/bao/dp-report/workers?status=bogus`, { headers })).status).toBe(400);
    calculate.mockRejectedValueOnce(new Error("secret database details"));
    const response = await fetch(`${base}/api/sitespecific/bao/dp-report/summary`, { headers });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Failed to calculate Domestic Partner report" });
  });
});