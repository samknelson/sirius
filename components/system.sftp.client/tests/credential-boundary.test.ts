/**
 * Credential boundary for file-transfer destinations: configured passwords,
 * private keys and passphrases must never reach audit payloads, test-operation
 * logs, returned errors, or cached/logged HTTP bodies. Fake SDK clients only —
 * no network, database or server.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  log: vi.fn(),
  sftpConnect: vi.fn(),
  ftpAccess: vi.fn(),
  connectFail: null as string | null,
  readFail: null as string | null,
  reads: 0,
}));

vi.mock("../../../server/logger", () => ({ storageLogger: { log: state.log } }));
vi.mock("../../../server/middleware/request-context", () => ({ getRequestContext: () => undefined }));
// Keep collection database-free: no pool, no storage barrel, no route graph.
vi.mock("../../../server/storage", () => ({ storage: {} }));
vi.mock("../../../server/storage/transaction-context", () => ({ getClient: () => { throw new Error("no database in this suite"); } }));
vi.mock("../server/modules/sftp-client-destinations", () => ({ registerSftpClientDestinationRoutes: vi.fn() }));

vi.mock("ssh2-sftp-client", () => ({
  default: class {
    async connect(opts: unknown) { state.sftpConnect(opts); if (state.connectFail) throw new Error(state.connectFail); }
    async cwd() { return "/home"; }
    async list() { return []; }
    createReadStream() { state.reads++; throw new Error(state.readFail ?? "unexpected"); }
    async end() {}
  },
}));
vi.mock("basic-ftp", () => ({
  Client: class {
    ftp = { verbose: true };
    async access(opts: unknown) { state.ftpAccess(opts); }
    async pwd() { return "/"; }
    async list() { if (state.connectFail) throw new Error(state.connectFail); return []; }
    async downloadTo() { state.reads++; throw new Error(state.readFail ?? "unexpected"); }
    close() {}
  },
}));

import * as transfer from "../server/services/file-transfer-client";
import { sftpClientDestinationLoggingConfig } from "../server/storage/sftp-client-destinations";
import { captureHttpPrivacy, isHttpBodyPrivate } from "../../../server/services/http-response-privacy";
import { register } from "../server/startup";

// Quote, backslash, slash and plus: exercise JSON-escaped and URL-encoded spellings.
const PASSWORD = 'pw-canary"Q\\uote/+Zx91';
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nkey-canary+Ab/Cd==\n-----END OPENSSH PRIVATE KEY-----";
const PASSPHRASE = "phrase-canary/+Kq\"7";
const SECRETS = [PASSWORD, PRIVATE_KEY, PASSPHRASE];

const ftpConn = { protocol: "ftp", host: "ftp.example.test", port: 21, username: "u", password: PASSWORD, tlsMode: "none" } as any;
const sftpConn = { protocol: "sftp", host: "sftp.example.test", port: 22, username: "u", privateKey: PRIVATE_KEY, passphrase: PASSPHRASE } as any;

/** Whole values and 8-char fragments, in raw, JSON-escaped and URL-encoded spellings. */
function expectNoSecret(value: unknown, secrets: string[] = SECRETS) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of secrets) {
    for (const spelling of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)]) {
      for (let i = 0; i + 8 <= spelling.length; i += 4) {
        expect(text).not.toContain(spelling.slice(i, i + 8));
      }
    }
  }
}

/** What a vendor error might quote back: each configured secret in every spelling. */
const echo = (secrets: string[]) => secrets.flatMap((s) => [s, encodeURIComponent(s), JSON.stringify(s).slice(1, -1)]).join(" | ");

beforeEach(() => {
  vi.clearAllMocks();
  state.connectFail = null;
  state.readFail = null;
  state.reads = 0;
});

describe("transfer results and test-operation logs", () => {
  it("successful operations log no configured credential but still authenticate", async () => {
    const sftp = await transfer.testConnect(sftpConn, "dest-1");
    const ftp = await transfer.testList(ftpConn, "/", "dest-1");
    expect(sftp.success && ftp.success).toBe(true);
    expect(state.sftpConnect).toHaveBeenCalledWith(expect.objectContaining({ privateKey: PRIVATE_KEY, passphrase: PASSPHRASE }));
    expect(state.ftpAccess).toHaveBeenCalledWith(expect.objectContaining({ password: PASSWORD }));
    expect(state.log).toHaveBeenCalledTimes(2);
    expectNoSecret([sftp, ftp, state.log.mock.calls]);
  });

  it("failures that echo configured credentials are scrubbed in result and log", async () => {
    state.connectFail = `auth rejected: ${echo(SECRETS)}`;
    const sftp = await transfer.testConnect({ ...sftpConn, password: PASSWORD }, "dest-1");
    expect(sftp.success).toBe(false);
    expect(sftp.error).toContain("[REDACTED]");
    expectNoSecret([sftp, state.log.mock.calls]);

    state.connectFail = `auth rejected: ${echo([PASSWORD])}`;
    const ftp = await transfer.testList(ftpConn, "/", "dest-1");
    expect(ftp.success).toBe(false);
    expect(state.log).toHaveBeenCalledWith("warn", expect.any(String), expect.any(Object));
    expectNoSecret([ftp, state.log.mock.calls], [PASSWORD]);
  });

  it.each([["ftp", ftpConn, [PASSWORD]], ["sftp", { ...sftpConn, password: PASSWORD }, SECRETS]])(
    "%s download errors are scrubbed in the thrown error and the log",
    async (_label, conn, secrets) => {
      state.readFail = `read failed: ${echo(secrets)}`;
      const { PassThrough } = await import("stream");
      const thrown = await transfer.streamDownload(conn, "/f.txt", "dest-1", new PassThrough()).catch((e: Error) => e);
      expect(state.reads).toBe(1);
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toContain("[REDACTED]");
      expect(state.log).toHaveBeenCalledWith("warn", expect.any(String), expect.any(Object));
      expectNoSecret([(thrown as Error).message, (thrown as Error).stack, state.log.mock.calls], secrets);
    },
  );
});

describe("destination storage audit payloads", () => {
  const row = { id: "dest-1", siriusId: "s1", name: "Dest", data: { ...sftpConn, password: PASSWORD } } as any;
  const fakeStorage = { getById: async () => row } as any;
  const { create, update, delete: del } = sftpClientDestinationLoggingConfig.methods as any;

  it("create, update and delete audit payloads omit connection credentials", async () => {
    const before = await update.before(["dest-1", row], fakeStorage);
    const payloads = [
      create.logArgs([row]),
      await create.after([row], row),
      update.logArgs(["dest-1", { data: row.data }]),
      before,
      await update.after(["dest-1", row], row, fakeStorage, before),
      await del.before(["dest-1"], fakeStorage),
    ];
    expect(JSON.stringify(payloads)).toContain('"configured":true');
    expectNoSecret(payloads);
  });
});

describe("component-owned private HTTP scope", () => {
  it("destination responses are private, including mixed-case paths", () => {
    register();
    for (const path of ["/api/sftp/client-destinations", "/API/Sftp/Client-Destinations/dest-1/test/download"]) {
      const res = { setHeader: vi.fn(), vary: vi.fn() } as any;
      captureHttpPrivacy({ path } as any, res, () => {});
      expect(isHttpBodyPrivate(res)).toBe(true);
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    }
  });
});
