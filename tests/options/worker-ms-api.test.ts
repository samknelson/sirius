/**
 * Task 415 — worker-ms options API contract (DB-backed).
 *
 * Pins the read-write contract for the member-status hours threshold:
 *   - POST/PUT reject invalid thresholds (non-negative whole hours only),
 *   - a `data` update is a DEEP MERGE into the row's current JSON — saving
 *     the threshold (or any other field) never erases unrelated
 *     member-status JSON,
 *   - an explicit null leaf clears the threshold while preserving siblings,
 *   - updating a non-data field leaves `data` untouched.
 *
 * Auth middleware is stubbed to pass-through (the real access policies are
 * covered elsewhere); everything else — routes, registry, unified-options
 * storage, the real dev database — is production code.
 */
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
import { getOptionsStorage } from "../../server/modules/options-registry";

const run = `ms-thresh-api-${Date.now()}`;
let base = "";
let closeServer: (() => Promise<void>) | undefined;
let industryId = "";
const createdMs: string[] = [];

async function request(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${base}${path}`, { ...init, headers });
}

beforeAll(async () => {
  const options = getOptionsStorage();
  industryId = (await options.create("industry", { name: `${run} industry` })).id;

  const app = express();
  app.use(express.json());
  registerConsolidatedOptionsRoutes(app);
  const server = await new Promise<any>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  base = `http://127.0.0.1:${server.address().port}`;
  closeServer = () =>
    new Promise((resolve, reject) => server.close((e: Error) => (e ? reject(e) : resolve())));
}, 60_000);

afterAll(async () => {
  await closeServer?.();
  const options = getOptionsStorage();
  for (const id of createdMs) await options.delete("worker-ms", id).catch(() => {});
  if (industryId) await options.delete("industry", industryId).catch(() => {});
}, 60_000);

async function createMs(data?: unknown) {
  const res = await request("/api/options/worker-ms", {
    method: "POST",
    body: JSON.stringify({ name: `${run}-${createdMs.length}`, industryId, ...(data !== undefined ? { data } : {}) }),
  });
  const body = await res.json();
  if (res.status === 201 || res.status === 200) createdMs.push(body.id);
  return { status: res.status, body };
}

describe("worker-ms options API — threshold validation and sibling preservation", () => {
  it("rejects an invalid threshold on create and update", async () => {
    const bad = await createMs({ sitespecific: { bao: { threshold: -5 } } });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toMatch(/whole number/);

    const created = await createMs({ sitespecific: { bao: { threshold: 60 } } });
    expect([200, 201]).toContain(created.status);

    for (const invalid of [12.5, "60", -1]) {
      const res = await request(`/api/options/worker-ms/${created.body.id}`, {
        method: "PUT",
        body: JSON.stringify({ data: { sitespecific: { bao: { threshold: invalid } } } }),
      });
      expect(res.status).toBe(400);
    }
    // Row unchanged after the rejected updates.
    const row = await (await request(`/api/options/worker-ms/${created.body.id}`)).json();
    expect(row.data?.sitespecific?.bao?.threshold).toBe(60);
  });

  it("deep-merges a threshold update without erasing sibling JSON", async () => {
    const created = await createMs({
      s1Tid: 1666,
      sitespecific: { bao: { threshold: 100, legacyFlag: true } },
    });
    const id = created.body.id;

    const res = await request(`/api/options/worker-ms/${id}`, {
      method: "PUT",
      body: JSON.stringify({ data: { sitespecific: { bao: { threshold: 60 } } } }),
    });
    expect(res.status).toBe(200);
    const row = await (await request(`/api/options/worker-ms/${id}`)).json();
    expect(row.data).toEqual({
      s1Tid: 1666,
      sitespecific: { bao: { threshold: 60, legacyFlag: true } },
    });
  });

  it("clears the threshold via an explicit null leaf, preserving siblings", async () => {
    const created = await createMs({
      keep: "me",
      sitespecific: { bao: { threshold: 80 } },
    });
    const id = created.body.id;
    const res = await request(`/api/options/worker-ms/${id}`, {
      method: "PUT",
      body: JSON.stringify({ data: { sitespecific: { bao: { threshold: null } } } }),
    });
    expect(res.status).toBe(200);
    const row = await (await request(`/api/options/worker-ms/${id}`)).json();
    expect(row.data).toEqual({ keep: "me" });
  });

  it("updating a non-data field leaves data untouched", async () => {
    const created = await createMs({ sitespecific: { bao: { threshold: 40 } } });
    const id = created.body.id;
    const res = await request(`/api/options/worker-ms/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name: `${run}-renamed` }),
    });
    expect(res.status).toBe(200);
    const row = await (await request(`/api/options/worker-ms/${id}`)).json();
    expect(row.name).toBe(`${run}-renamed`);
    expect(row.data?.sitespecific?.bao?.threshold).toBe(40);
  });

  it("prunes null leaves on create rather than persisting them", async () => {
    const created = await createMs({ sitespecific: { bao: { threshold: null } }, note: "x" });
    expect([200, 201]).toContain(created.status);
    const row = await (await request(`/api/options/worker-ms/${created.body.id}`)).json();
    expect(row.data).toEqual({ note: "x" });
  });
});
