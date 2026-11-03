import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { SessionData } from "express-session";
const calls = vi.hoisted(() => ({ args: [] as any[] }));
vi.mock("../../server/storage", () => ({ storage: { sessions: {
  getSessionData: async () => ({ passport: { user: { dbUser: { id: "fictional" } } } }),
  upsertSession: async (...args: any[]) => { calls.args = args; },
} } }));
vi.mock("../../server/logger", () => ({ logger: { error() {} } }));
import { StorageSessionStore } from "../../server/auth/session-store";

describe("express-session lifecycle observation is not authoritative policy", () => {
  it("requires a loaded SID to still exist, strips its marker, but allows a regenerated authentication SID", async () => {
    const store = new StorageSessionStore({ ttlMs: 1000 });
    const payload = await new Promise<SessionData>((resolve, reject) =>
      store.get("old-fictional-sid", (error, value) => error ? reject(error) : resolve(value!)));
    expect((payload as any)._presentationObserved)
      .toBe(createHash("sha256").update("old-fictional-sid").digest("hex"));
    await new Promise<void>((resolve, reject) =>
      store.set("old-fictional-sid", payload, error => error ? reject(error) : resolve()));
    expect(calls.args[3]).toBe(true);
    expect(calls.args[1]._presentationObserved).toBeUndefined();
    expect(JSON.stringify(calls.args[1])).not.toContain("old-fictional-sid");
    await new Promise<void>((resolve, reject) =>
      store.set("new-regenerated-sid", payload, error => error ? reject(error) : resolve()));
    expect(calls.args[3]).toBe(false);
    expect(calls.args[1]._presentationObserved).toBeUndefined();
  });
});
