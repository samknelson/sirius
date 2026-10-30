import { IncomingMessage, Server } from "node:http";
import { Socket } from "node:net";
import { Duplex } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setEnvironmentVariableOverride } from "../../server/config/env-registry";

vi.mock("../../server/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import {
  broadcastNotificationSummary, getConnectionCount, initializeWebSocket, shutdown,
} from "../../server/services/websocket";

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

beforeEach(() => {
  setEnvironmentVariableOverride("PUBLIC_URL", () => origin);
  server = new Server();
  sockets = [];
  session = vi.fn((req, _res, next) => {
    req.session = { passport: { user: { dbUser: { id: "private-user" } } } };
    next();
  });
});

afterEach(() => {
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
    expect(broadcastNotificationSummary("private-user", "private-event", { inapp: 1 })).toBe(false);
    expect(socket.output).not.toContain("private-event");
  });

  it("accepts the canonical proxy-facing origin and delivers only the user's events", async () => {
    const socket = upgrade({ origin }, "/ws?reconnect=1");
    await Promise.resolve();
    expect(socket.output).toContain("HTTP/1.1 101 Switching Protocols");
    expect(session).toHaveBeenCalledOnce();
    expect(getConnectionCount()).toBe(1);
    expect(socket.output).toContain('"type":"connected"');
    expect(broadcastNotificationSummary("private-user", "private-event", { inapp: 1 })).toBe(true);
    expect(socket.output).toContain('"id":"private-event"');
    expect(broadcastNotificationSummary("other-user", "other-event", { email: 1 })).toBe(false);
    expect(socket.output).not.toContain("other-event");
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
