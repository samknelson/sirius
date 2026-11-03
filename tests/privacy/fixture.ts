import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createMaskModeMiddleware } from "../../server/privacy/middleware";
import { readMaskState } from "../../shared/privacy/mask-mode";

export const CANARY = "PRIVATE_SURNAME_CANARY_491";
export const RAW = {
  family: CANARY, given: "PRIVATE_GIVEN_CANARY", ssn: "987-65-4321",
  siriusId: 987654321, value: "EXTERNAL_ID_CANARY_987654321",
  data: { nested: CANARY }, accessUuid: "BEARER_CANARY", email: "private@example.invalid",
};

/** Entirely in memory. No production accounts, sessions, DB, provider or records. */
export async function startPrivacyFixture() {
  const rows = new Map<string, any>([
    ["presenter", { passport: { user: { dbUser: { id: "fixture-admin" } } },
      maskMode: { version: 1, mode: "off", revision: 1 } }],
    ["other", { passport: { user: { dbUser: { id: "fixture-other" } } },
      maskMode: { version: 1, mode: "off", revision: 1 } }],
    ["legacy", { passport: { user: { dbUser: { id: "fixture-admin" } } } }],
    ["nonadmin", { passport: { user: { dbUser: { id: "fixture-staff" } } },
      maskMode: { version: 1, mode: "on", revision: 1 } }],
  ]);
  const controls = {
    failRead: false, failTransition: false, failPermissions: false, loseLease: false,
    effects: 0, reads: 0, targetCanRead: true, pending: 0,
  };
  const locks = new Map<string, { readers: number; writer: boolean }>();
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const sid = /(?:^|;\s*)fixture=([^;]+)/.exec(req.get("cookie") ?? "")?.[1] ?? "anonymous";
    const sess = structuredClone(rows.get(sid) ?? {});
    (req as any).sessionID = sid;
    (req as any).session = Object.assign(sess, {
      destroy(cb: (err?: unknown) => void) { rows.delete(sid); cb(); },
    });
    (req as any).user = sess.passport?.user;
    next();
  });
  app.use(createMaskModeMiddleware({
    async acquire(sid, exclusive) {
      const key = `presentation:${sid}`;
      const lock = locks.get(key) ?? { readers: 0, writer: false };
      locks.set(key, lock);
      const deadline = Date.now() + 2800;
      while (lock.writer || (exclusive && lock.readers > 0)) {
        if (Date.now() > deadline) return null;
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      if (exclusive) lock.writer = true; else lock.readers++;
      let held = true;
      return {
        name: key, waitedMs: 0, contended: false,
        isHeld: () => held && !controls.loseLease,
        async release() {
          if (!held) return;
          held = false;
          if (exclusive) lock.writer = false; else lock.readers--;
        },
      };
    },
    async read(sid) {
      if (controls.failRead) throw new Error(CANARY);
      return structuredClone(rows.get(sid));
    },
    async transition(sid, expected, mode) {
      if (controls.failTransition) throw new Error(CANARY);
      const row = rows.get(sid);
      if (!row || readMaskState(row.maskMode).revision !== expected) return null;
      row.maskMode = { version: 1, mode, revision: expected + 1 };
      return { ...row.maskMode };
    },
    async permissions(req) {
      if (controls.failPermissions) throw new Error(CANARY);
      return { canToggle: (req.user as any)?.dbUser?.id === "fixture-admin",
        canRead: controls.targetCanRead };
    },
    async people() {
      controls.reads++;
      return [
        { birthDate: "1980-02-29", ...RAW },
        { birthDate: "1901-12-31", ...RAW },
        { birthDate: "not-a-date", ...RAW },
      ];
    },
  }));
  // Domain handlers are deliberately dangerous CANARY doubles. A protected
  // request must never reach any of them, regardless of method/transport.
  app.all("/api/domain", (_req, res) => { controls.effects++; res.json(RAW); });
  app.get("/api/slow", async (_req, res) => {
    controls.pending++;
    await new Promise(resolve => setTimeout(resolve, 200));
    res.json(RAW);
    controls.pending--;
  });
  app.get("/files/canary.pdf", (_req, res) => { controls.effects++; res.type("application/pdf").send(CANARY); });
  app.get("/public-files/canary", (_req, res) => { controls.effects++; res.send(CANARY); });
  app.get("/api/redirect", (_req, res) => { controls.effects++; res.redirect(`https://example.invalid/${CANARY}`); });
  app.get("/api/sse", (_req, res) => { controls.effects++; res.type("text/event-stream").send(`data: ${CANARY}\n\n`); });
  app.get("/api/error", (_req, res) => { controls.effects++; res.status(500).json({ message: CANARY }); });
  app.get("/", (_req, res) => res.send("<html><title>OFF fixture</title><body>OFF fixture</body></html>"));
  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin, rows, controls, locks, app,
    async request(path: string, init: RequestInit = {}, sid = "presenter") {
      return fetch(`${origin}${path}`, {
        ...init, redirect: "manual",
        headers: { cookie: `fixture=${sid}`, origin, "Content-Type": "application/json", ...init.headers },
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
