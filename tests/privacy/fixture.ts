import express from "express";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { createMaskModeMiddleware } from "../../server/privacy/middleware";
import { guardedPresentationDelivery } from "../../server/privacy/socket";
import { readMaskState } from "../../shared/privacy/mask-mode";

export const CANARY = "FictionalSurname";
export const RAW = {
  family: CANARY, given: "Morgan", ssn: "123-45-6789",
  siriusId: 987654321, value: "ABC-12345", email: "morgan@example.invalid",
};

/** Fictional data only; no database, providers, vendor calls or shared accounts. */
export async function startPrivacyFixture() {
  const rows = new Map<string, any>([
    ["presenter", { passport: { user: { dbUser: { id: "fixture-admin" } } }, maskMode: { version: 1, mode: "off", revision: 1 } }],
    ["other", { passport: { user: { dbUser: { id: "fixture-other" } } }, maskMode: { version: 1, mode: "off", revision: 1 } }],
    ["legacy", { passport: { user: { dbUser: { id: "fixture-admin" } } }, maskModeRevoked: true }],
    ["nonadmin", { passport: { user: { dbUser: { id: "fixture-staff" } } }, maskMode: { version: 1, mode: "on", revision: 1 } }],
  ]);
  const controls = { enabled: true, epoch: "fixture", failComponent: false, failRead: false,
    failTransition: false, failPermissions: false, effects: 0 };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const sid = /(?:^|;\s*)fixture=([^;]+)/.exec(req.get("cookie") ?? "")?.[1] ?? "anonymous";
    (req as any).sessionID = sid;
    (req as any).session = structuredClone(rows.get(sid) ?? {});
    (req as any).user = rows.get(sid)?.passport?.user;
    next();
  });
  app.use(createMaskModeMiddleware({
    async component() {
      if (controls.failComponent) throw new Error(CANARY);
      return { enabled: controls.enabled, epoch: controls.epoch };
    },
    async read(sid) {
      if (controls.failRead) throw new Error(CANARY);
      return structuredClone(rows.get(sid));
    },
    async transition(sid, revision, mode) {
      if (controls.failTransition) throw new Error(CANARY);
      const row = rows.get(sid);
      if (!row || readMaskState(row.maskMode).revision !== revision) return null;
      row.maskMode = { version: 1, mode, revision: revision + 1 };
      delete row.maskModeRevoked;
      return { ...row.maskMode };
    },
    async permissions(req) {
      if (controls.failPermissions) throw new Error(CANARY);
      return { canToggle: (req.user as any)?.dbUser?.id === "fixture-admin", canRead: true };
    },
  }));
  app.all("/api/domain", (_req, res) => { controls.effects++; res.json(RAW); });
  app.get("/files/canary.pdf", (_req, res) => res.type("application/pdf").send(CANARY));
  app.get("/", (_req, res) => res.send("<html><title>Normal application</title><body>Normal application</body></html>"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const ws = new WebSocketServer({ server, path: "/ws" });
  ws.on("connection", (socket, req) => {
    const sid = /fixture=([^;]+)/.exec(req.headers.cookie ?? "")?.[1] ?? "";
    const actor = rows.get(sid)?.passport?.user?.dbUser?.id;
    void guardedPresentationDelivery(sid, actor, async () => { socket.send(JSON.stringify(RAW)); },
      { read: async sid => rows.get(sid) }).then(sent => { if (!sent) socket.close(4001); });
  });
  return { origin, rows, controls, app,
    request(path: string, init: RequestInit = {}, sid = "presenter") {
      return fetch(`${origin}${path}`, { ...init, redirect: "manual",
        headers: { cookie: `fixture=${sid}`, origin, "Content-Type": "application/json", ...init.headers } });
    },
    async close() {
      ws.clients.forEach(socket => socket.terminate());
      await new Promise<void>(resolve => ws.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
