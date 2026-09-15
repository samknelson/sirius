import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { BaoEeContributionRate } from "@shared/schema";
import type { BaoEeContributionRatesStorage } from "../../server/storage/sitespecific/bao/ee-contribution-rates";
import { registerBaoEeContributionRatesRoutes } from "../../server/modules/sitespecific/bao/ee-contribution-rates";

const otherPolicyRate: BaoEeContributionRate = {
  id: "rate-for-policy-b",
  policyId: "policy-b",
  benefitId: "benefit-1",
  rate: "25.00",
  effectiveYmd: "2026-01-01",
};

const update = vi.fn(async () => otherPolicyRate);
const remove = vi.fn(async () => true);
const ratesStorage: BaoEeContributionRatesStorage = {
  tableExists: async () => true,
  list: async () => [],
  get: async () => otherPolicyRate,
  getEffectiveRate: async () => undefined,
  create: async (entry) => ({ id: "created-rate", ...entry }),
  update,
  delete: remove,
};

let componentEnabled = true;
let base = "";
let closeServer: (() => Promise<void>) | undefined;

function request(path: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, init);
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const requireAuth: any = (req: any, res: any, next: any) => {
    if (req.header("x-auth") !== "yes") {
      return res.status(401).json({ message: "auth required" });
    }
    next();
  };
  const requireAccess: any = (policy: string) => (req: any, res: any, next: any) => {
    // The policy route itself is admin-gated. Fail the harness loudly if a
    // future route edit broadens this to staff or removes the access gate.
    if (policy !== "admin") {
      return res.status(500).json({ message: `unexpected access policy: ${policy}` });
    }
    if (req.header("x-admin") !== "yes") {
      return res.status(403).json({ message: "admin required" });
    }
    next();
  };
  const componentMiddleware: any = (_req: any, res: any, next: any) => {
    if (!componentEnabled) {
      return res.status(403).json({ error: "component_disabled" });
    }
    next();
  };
  registerBaoEeContributionRatesRoutes(
    app,
    requireAuth,
    () => () => undefined,
    requireAccess,
    { ratesStorage, componentMiddleware },
  );
  const server = await new Promise<any>((resolve) => {
    const value = app.listen(0, "127.0.0.1", () => resolve(value));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () =>
    new Promise((resolve, reject) =>
      server.close((error: Error) => (error ? reject(error) : resolve())),
    );
});

afterAll(async () => {
  await closeServer?.();
});

describe("BAO employee contribution rate routes", () => {
  it("requires authentication, the BAO component, and admin access", async () => {
    const path = "/api/policies/policy-a/bao-ee-contribution-rates";
    expect((await request(path)).status).toBe(401);

    expect(
      (
        await request(path, {
          headers: { "x-auth": "yes" },
        })
      ).status,
    ).toBe(403);

    componentEnabled = false;
    expect(
      (
        await request(path, {
          headers: { "x-auth": "yes", "x-admin": "yes" },
        })
      ).status,
    ).toBe(403);
    componentEnabled = true;
  });

  it("rejects patch and delete for a rate belonging to another policy before mutation", async () => {
    const path = "/api/policies/policy-a/bao-ee-contribution-rates/rate-for-policy-b";
    const headers = { "content-type": "application/json", "x-auth": "yes", "x-admin": "yes" };

    expect(
      (
        await request(path, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ rate: "30.00" }),
        })
      ).status,
    ).toBe(404);
    expect((await request(path, { method: "DELETE", headers })).status).toBe(404);
    expect(update).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});