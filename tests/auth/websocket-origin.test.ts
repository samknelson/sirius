import { IncomingMessage, Server } from "node:http";
import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvironmentVariableOverride } from "../../server/config/env-registry";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../../server/storage/transaction-context", () => ({
  runOutsideTransaction: (fn: () => unknown) => fn(),
}));

import {
  broadcastNotificationSummary, getConnectionCount, initializeWebSocket, shutdown, onNotificationSummaryAck,
} from "../../server/services/websocket";
import { endSessionSocketAuthority } from "../../server/auth/socket-authority";

// Exercise the real ws handshake and event delivery without a listening server,
// database, or network. Captured output includes the HTTP reply and WS frames.
class UpgradeSocket extends Duplex {
  output = "";
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    this.output += chunk.toString();
    done();
  }
}

const origin = "https://app.example.test";
let server: Server;
let session: ReturnType<typeof vi.fn>;
let sockets: UpgradeSocket[];
let appWss: ReturnType<typeof initializeWebSocket>;
let persisted: Map<string, any>;
let storeGet: ReturnType<typeof vi.fn>;

async function settled() {
  // Both session restoration and the independent persisted-authority read.
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
  setEnvironmentVariableOverride("PUBLIC_URL", () => origin);
  server = new Server();
  sockets = [];
  persisted = new Map([["session-one", {
    passport: { user: { dbUser: { id: "private-user" } } },
    _socketAuthorityVersion: "generation-one",
  }]]);
  storeGet = vi.fn((sid, callback) => callback(null, persisted.get(sid)));
  session = vi.fn((req, _res, next) => {
    req.sessionID = req.headers["x-test-session"] ?? "session-one";
    req.session = persisted.get(req.sessionID);
    req.sessionStore = { get: storeGet };
    next();
  });
});

afterEach(() => {
  vi.useRealTimers();
  appWss?.clients.forEach(ws => ws.terminate());
  shutdown();
  sockets.forEach(socket => socket.destroy());
  setEnvironmentVariableOverride("PUBLIC_URL", null);
  setEnvironmentVariableOverride("NODE_ENV", null);
});

function upgrade(headers: Record<string, string | string[]> = {}, path = "/ws") {
  const socket = new UpgradeSocket();
  sockets.push(socket);
  const req = new IncomingMessage(new Socket());
  req.method = "GET";
  req.url = path;
  req.headers = {
    host: "internal-proxy:5000",
    upgrade: "websocket",
    connection: "Upgrade",
    "sec-websocket-version": "13",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    cookie: "signed-session=canary",
    ...headers,
  };
  server.emit("upgrade", req, socket, Buffer.alloc(0));
  return socket;
}

describe.each(["development", "production"])("%s application socket origin boundary", mode => {
  beforeEach(() => {
    setEnvironmentVariableOverride("NODE_ENV", () => mode);
    appWss = initializeWebSocket(server, session);
  });

  it.each<Record<string, string | string[]>>([
    {}, { origin: "https://attacker.test" }, { origin: "https://sibling.example.test" },
    { origin: "http://app.example.test" }, { origin: origin + ":444" },
    { origin: "null" }, { origin: "" }, { origin: "not a url" },
    { origin: origin + "/" }, { origin: origin + "?x=1" }, { origin: origin + "#fragment" },
    { origin: "https://user@app.example.test" }, { origin: "wss://app.example.test" },
    { origin: origin + ", https://attacker.test" },
    { origin: [origin, origin] },
    { referer: origin + "/", "sec-fetch-site": "same-origin" },
    { origin: "null", referer: origin + "/" },
    { origin: "https://attacker.test", host: "app.example.test", "x-forwarded-host": "app.example.test" },
  ])("refuses %j before handshake, session restoration, or private events", async headers => {
    const socket = upgrade(headers);
    await Promise.resolve();
    expect(socket.output).toBe("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
    expect(session).not.toHaveBeenCalled();
    expect(appWss.clients.size).toBe(0);
    expect(getConnectionCount()).toBe(0);
    expect(await broadcastNotificationSummary("private-user", "private-event", { inapp: 1 })).toBe(false);
    expect(socket.output).not.toContain("private-event");
  });

  it("accepts the canonical proxy-facing origin and delivers only the user's events", async () => {
    const socket = upgrade({ origin }, "/ws?reconnect=1");
    await settled();
    expect(socket.output).toContain("HTTP/1.1 101 Switching Protocols");
    expect(session).toHaveBeenCalledOnce();
    expect(getConnectionCount()).toBe(1);
    expect(socket.output).toContain('"type":"connected"');
    expect(await broadcastNotificationSummary("private-user", "private-event", { inapp: 1 })).toBe(true);
    expect(socket.output).toContain('"id":"private-event"');
    expect(await broadcastNotificationSummary("other-user", "other-event", { email: 1 })).toBe(false);
    expect(socket.output).not.toContain("other-event");
  });

  it("revokes only the authorizing session, preserving other sessions and reconnects", async () => {
    persisted.set("session-two", structuredClone(persisted.get("session-one")));
    const first = upgrade({ origin });
    const second = upgrade({ origin, "x-test-session": "session-two" });
    await settled();
    expect(getConnectionCount()).toBe(2);
    persisted.delete("session-one");
    endSessionSocketAuthority("session-one");
    expect(getConnectionCount()).toBe(1);
    expect(await broadcastNotificationSummary("private-user", "after-logout", { inapp: 1 })).toBe(true);
    expect(first.output).not.toContain("after-logout");
    expect(second.output).toContain("after-logout");

    const reconnect = upgrade({ origin, "x-test-session": "session-two" });
    await settled();
    expect(getConnectionCount()).toBe(2);
    expect(await broadcastNotificationSummary("private-user", "reconnected", { inapp: 1 })).toBe(true);
    expect(reconnect.output).toContain("reconnected");
  });

  it.each(["deleted", "expired", "provider-expired", "masquerade", "owner", "generation", "anonymous", "unavailable"])(
    "refuses private sends after %s authority changes, including remote changes", async change => {
      const socket = upgrade({ origin });
      await settled();
      const saved = structuredClone(persisted.get("session-one"));
      if (change === "deleted") persisted.delete("session-one");
      if (change === "expired") saved.cookie = { expires: new Date(Date.now() - 1).toISOString() };
      if (change === "provider-expired") saved.passport.user.expires_at = Date.now() / 1000 - 1;
      if (change === "masquerade") saved.masqueradeUserId = "target-user";
      if (change === "owner") saved.passport.user.dbUser.id = "other-owner";
      // Same owner and target after A→B→A is still a different authority.
      if (change === "generation") saved._socketAuthorityVersion = "generation-two";
      if (change === "anonymous") delete saved.passport;
      if (change === "unavailable") storeGet.mockImplementation((_sid, callback) => callback(new Error("offline")));
      if (change !== "deleted") persisted.set("session-one", saved);
      expect(await broadcastNotificationSummary("private-user", "must-not-deliver", { email: 1 })).toBe(false);
      expect(socket.output).not.toContain("must-not-deliver");
      expect(getConnectionCount()).toBe(0);
    },
  );

  it("checks expiry during heartbeats even when the peer keeps sending pong", async () => {
    shutdown();
    vi.useFakeTimers();
    appWss = initializeWebSocket(server, session);
    upgrade({ origin });
    await settled();
    const ws = [...appWss.clients][0];
    ws.emit("message", Buffer.from('{"type":"pong"}'));
    persisted.delete("session-one"); // Also how an idle-expired store read answers.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getConnectionCount()).toBe(0);
    expect(storeGet.mock.calls.length).toBeGreaterThan(1);
  });

  it("does not let a revoked socket acknowledge a private summary", async () => {
    const ack = vi.fn();
    onNotificationSummaryAck(ack);
    upgrade({ origin });
    await settled();
    persisted.delete("session-one");
    [...appWss.clients][0].emit("message", Buffer.from('{"type":"notification_summary_ack","id":"private-ack"}'));
    await settled();
    expect(ack).not.toHaveBeenCalled();
    expect(getConnectionCount()).toBe(0);
  });

  it("reconnects under the new masqueraded identity, never under the old owner", async () => {
    const oldSocket = upgrade({ origin });
    await settled();
    const saved = structuredClone(persisted.get("session-one"));
    saved.masqueradeUserId = "target-user";
    saved._socketAuthorityVersion = "masquerade-generation";
    persisted.set("session-one", saved);
    endSessionSocketAuthority("session-one");
    const newSocket = upgrade({ origin });
    await settled();
    expect(await broadcastNotificationSummary("private-user", "owner-only", { inapp: 1 })).toBe(false);
    expect(await broadcastNotificationSummary("target-user", "target-only", { inapp: 1 })).toBe(true);
    expect(oldSocket.output).not.toContain("target-only");
    expect(newSocket.output).toContain("target-only");
    expect(newSocket.output).not.toContain("owner-only");
  });

  it("does not register a peer that closes during the sign-in check", async () => {
    let finish!: () => void;
    session.mockImplementation((req, _res, next) => {
      req.sessionID = "session-one";
      req.session = persisted.get("session-one");
      req.sessionStore = { get: storeGet };
      finish = next;
    });
    upgrade({ origin });
    [...appWss.clients][0].terminate();
    finish();
    await settled();
    expect(getConnectionCount()).toBe(0);
  });

  it("fails closed on restoration errors and sign-in/revocation races", async () => {
    session.mockImplementationOnce((_req, _res, next) => next(new Error("store failed")));
    upgrade({ origin });
    await settled();
    expect(getConnectionCount()).toBe(0);
    storeGet.mockImplementationOnce((_sid, callback) => callback(null, undefined));
    upgrade({ origin });
    await settled();
    expect(getConnectionCount()).toBe(0);
  });

  it("uses the registry's current canonical origin, not a startup snapshot", async () => {
    setEnvironmentVariableOverride("PUBLIC_URL", () => "https://new.example.test");
    expect(upgrade({ origin }).output).toContain("403 Forbidden");
    const socket = upgrade({ origin: "https://new.example.test" });
    await Promise.resolve();
    expect(socket.output).toContain("101 Switching Protocols");
    expect(session).toHaveBeenCalledOnce();
  });

  it("preserves an explicitly configured local HTTP development origin and port", async () => {
    setEnvironmentVariableOverride("PUBLIC_URL", () => "http://localhost:5000");
    const socket = upgrade({ origin: "http://localhost:5000" });
    await Promise.resolve();
    expect(socket.output).toContain("101 Switching Protocols");
    expect(upgrade({ origin: "http://localhost:5001" }).output).toContain("403 Forbidden");
    expect(session).toHaveBeenCalledOnce();
  });

  it.each(["/", "/vite-hmr", "/ws-other", "/api/ws/vendor/operation"])(
    "leaves another listener's %s socket untouched even without Origin", path => {
      const otherListener = vi.fn();
      server.on("upgrade", otherListener);
      const socket = upgrade({}, path);
      expect(otherListener).toHaveBeenCalledOnce();
      expect(socket.output).toBe("");
      expect(socket.destroyed).toBe(false);
      expect(session).not.toHaveBeenCalled();
      expect(appWss.clients.size).toBe(0);
    },
  );

  it("removes only its own listener on shutdown", () => {
    const otherListener = vi.fn();
    server.on("upgrade", otherListener);
    shutdown();
    expect(server.listeners("upgrade")).toEqual([otherListener]);
  });
});
