import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/services/access-policy-evaluator", async (importOriginal) => {
  const real = (await importOriginal()) as Record<string, unknown>;
  return {
    ...real,
    requireAccess: () => (_req: any, _res: any, next: any) => next(),
  };
});

import { registerConsolidatedOptionsRoutes } from "../../server/modules/options-routes";
import { registerTrustBenefitsRoutes } from "../../server/modules/trust/benefits";
import { getOptionsStorage } from "../../server/modules/options-registry";
import { storage } from "../../server/storage";

const run = `benefit-color-api-${Date.now()}`;
let base = "";
let closeServer: (() => Promise<void>) | undefined;
let colorOptionId: string | undefined;
let benefitId: string | undefined;

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

const pass = (_req: any, _res: any, next: any) => next();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerConsolidatedOptionsRoutes(app);
  registerTrustBenefitsRoutes(app, pass, () => pass);
  const server = await new Promise<any>((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () =>
    new Promise((resolve, reject) =>
      server.close((error: Error) => (error ? reject(error) : resolve())),
    );
}, 60_000);

afterAll(async () => {
  if (benefitId) await storage.trustBenefits.deleteTrustBenefit(benefitId).catch(() => false);
  if (colorOptionId) await getOptionsStorage().delete("color", colorOptionId).catch(() => false);
  await closeServer?.();
}, 60_000);

describe("trust benefit color API", () => {
  it("validates configured color IDs, exposes resolved values, clears references, and protects in-use options", async () => {
    const invalidOption = await request("/api/options/color", {
      method: "POST",
      body: JSON.stringify({ name: `${run} invalid`, color: "red" }),
    });
    expect(invalidOption.status).toBe(400);
    expect((await invalidOption.json()).message).toMatch(/six-digit hex/);

    const colorResponse = await request("/api/options/color", {
      method: "POST",
      body: JSON.stringify({ name: `${run} blue`, color: "#123ABC" }),
    });
    expect(colorResponse.status).toBe(201);
    const colorOption = await colorResponse.json();
    colorOptionId = colorOption.id;

    const rawColorResponse = await request("/api/trust-benefits", {
      method: "POST",
      body: JSON.stringify({ name: `${run} raw`, color: "#123ABC" }),
    });
    expect(rawColorResponse.status).toBe(400);
    expect((await rawColorResponse.json()).message).toMatch(/colorOptionId/);

    const invalidBenefit = await request("/api/trust-benefits", {
      method: "POST",
      body: JSON.stringify({ name: `${run} invalid reference`, colorOptionId: "missing-color-option" }),
    });
    expect(invalidBenefit.status).toBe(400);

    const createBenefit = await request("/api/trust-benefits", {
      method: "POST",
      body: JSON.stringify({ name: `${run} benefit`, colorOptionId }),
    });
    expect(createBenefit.status).toBe(201);
    const created = await createBenefit.json();
    benefitId = created.id;
    expect(created.colorOptionId).toBe(colorOptionId);

    const displayed = await (await request(`/api/trust-benefits/${benefitId}`)).json();
    expect(displayed).toMatchObject({ colorOptionId, color: "#123ABC", colorOptionName: `${run} blue` });

    const cannotDeleteWhileUsed = await request(`/api/options/color/${colorOptionId}`, { method: "DELETE" });
    expect(cannotDeleteWhileUsed.status).toBe(409);

    const clear = await request(`/api/trust-benefits/${benefitId}`, {
      method: "PUT",
      body: JSON.stringify({ colorOptionId: null }),
    });
    expect(clear.status).toBe(200);
    const uncolored = await (await request(`/api/trust-benefits/${benefitId}`)).json();
    expect(uncolored).toMatchObject({ colorOptionId: null, color: null });

    const canDeleteWhenUnused = await request(`/api/options/color/${colorOptionId}`, { method: "DELETE" });
    expect(canDeleteWhenUnused.status).toBe(204);
    colorOptionId = undefined;
  });
});
