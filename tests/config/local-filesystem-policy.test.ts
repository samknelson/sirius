import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { assertLocalPathAllowed } from "../../server/services/files/local-path-policy";
import { LocalFileSystemProvider } from "../../server/services/files/providers/local";
import { FilePathTraversalError } from "../../server/services/files/base";
import { parseFileSystemsEnv } from "../../server/services/files/config";
import {
  getFileSystemProvider, initFileSystems, listFileSystemConfigs,
} from "../../server/services/files/registry";
import { runReloads } from "../../server/services/reload-registry";
import { setEnvironmentVariableOverride } from "../../server/config/env-registry";

vi.mock("../../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../server/services/files/providers/replit", () => ({ ReplitFileSystemProvider: vi.fn() }));
vi.mock("../../server/services/files/providers/s3", () => ({ S3FileSystemProvider: vi.fn() }));
vi.mock("../../server/storage", () => ({
  storage: { files: { listDistinctFileSystemIds: async () => [] } },
}));
vi.mock("../../server/storage/configuration-revisions", () => ({
  readConfigurationSnapshot: (read: () => unknown) => read(),
}));
// The reload entry imports this barrel; avoid bringing unrelated file services/DBs in.
vi.mock("../../server/services/files", async () => import("../../server/services/files/registry"));

let temp: string;
const config = (base: string, id = "test") => ({
  [id]: { name: id, access: "private", provider: "local", provider_settings: { base_path: base } },
});
const provider = (base = path.join(temp, "storage")) =>
  new LocalFileSystemProvider("test", { base_path: base });

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(tmpdir(), "local-policy-"));
});
afterEach(async () => {
  setEnvironmentVariableOverride("FILESYSTEMS", null);
  await fs.rm(temp, { recursive: true, force: true });
});

describe("fixed local filesystem policy", () => {
  it.each(["/", "/proc", "/sys", "/dev", "/etc", "/run", "/var/run"])(
    "refuses %s and descendants without touching their contents",
    (base) => {
      const targets = base === "/"
        ? ["/", `${temp}/../..`]
        : [base, `${base}/future/deeper`, `${temp}/../../${base}/future`];
      for (const target of targets) {
        expect(() => assertLocalPathAllowed(target)).toThrow(/prohibited/);
        expect(() => parseFileSystemsEnv(JSON.stringify(config(target)))).toThrow(/FILESYSTEMS.*test.*base_path/);
        expect(() => provider(target)).toThrow(/prohibited/);
      }
    },
  );

  it("accepts harmless component-prefix lookalikes and future directories", async () => {
    for (const name of ["proc-data", "sys-backup", "devfiles", "etc", "runoff"]) {
      const base = path.join(temp, name, "future");
      expect(assertLocalPathAllowed(base)).toBe(base);
    }
    // Absolute lookalikes must not be confused with the blocked component.
    expect(assertLocalPathAllowed("/proc-storage")).toBe("/proc-storage");
    expect(assertLocalPathAllowed("/etc-backup")).toBe("/etc-backup");
    const alias = path.join(temp, "alias");
    await fs.symlink(temp, alias);
    expect(assertLocalPathAllowed(path.join(alias, "new", "deep"))).toBe(path.join(temp, "new", "deep"));
  });

  it("refuses physical aliases, future paths below aliases, and dangling links", async () => {
    for (const tree of ["/proc", "/sys", "/dev", "/etc", "/run"]) {
      const alias = path.join(temp, path.basename(tree));
      await fs.symlink(tree, alias);
      for (const base of [alias, path.join(alias, "not-created", "deep")]) {
        expect(() => assertLocalPathAllowed(base)).toThrow(/prohibited/);
        expect(() => parseFileSystemsEnv(JSON.stringify(config(base)))).toThrow(/invalid local/);
      }
    }
    const dangling = path.join(temp, "dangling");
    await fs.symlink(path.join(temp, "absent"), dangling);
    expect(() => assertLocalPathAllowed(path.join(dangling, "deep"))).toThrow(/dangling symlink/);
  });

  it("leaves nonlocal configuration validation unchanged", () => {
    const configs = parseFileSystemsEnv(JSON.stringify({
      replit: { name: "Replit", access: "private", provider: "replit", provider_settings: { bucket_id: "fixture" } },
      s3: { name: "S3", access: "private", provider: "s3", provider_settings: {
        bucket: "fixture", region: "us-east-1", access_key_id: "fixture", secret_access_key: "fixture",
      } },
    }));
    expect([...configs.keys()]).toEqual(["replit", "s3"]);
  });
});

describe("local operation enforcement", () => {
  it("supports all operation families on an initially nonexistent base and legitimate base alias", async () => {
    const alias = path.join(temp, "alias");
    await fs.symlink(temp, alias);
    const local = provider(path.join(alias, "future", "storage"));
    await local.write("nested/file", Buffer.from("fixture"));
    expect((await local.read("nested/file")).toString()).toBe("fixture");
    expect((await local.stat("nested/file"))?.size).toBe(7);
    expect((await local.list()).entries.map((e) => e.path)).toEqual(["nested/file"]);
    expect((await local.list({ delimiter: true })).directories).toEqual(["nested"]);
    expect((await local.list({ delimiter: true, prefix: "nested" })).entries).toHaveLength(1);
    await local.mkdir("empty");
    await local.rmdir("empty");
    await local.rename("nested/file", "new/file");
    await local.renameDirectory("new", "renamed");
    expect(await local.getSignedUrl("renamed/file")).toBeNull();
    await local.delete("renamed/file");
    await local.rmdir("renamed");
    expect(await local.stat("missing")).toBeNull();
    await local.delete("missing");
  });

  const operations: [string, (p: LocalFileSystemProvider) => Promise<unknown>][] = [
    ["read", (p) => p.read("file")],
    ["write", (p) => p.write("file", Buffer.from("fixture"))],
    ["delete", (p) => p.delete("file")],
    ["stat", (p) => p.stat("file")],
    ["recursive list", (p) => p.list()],
    ["root delimiter list", (p) => p.list({ delimiter: true })],
    ["prefix delimiter list", (p) => p.list({ delimiter: true, prefix: "dir" })],
    ["mkdir", (p) => p.mkdir("dir")],
    ["rmdir", (p) => p.rmdir("dir")],
    ["rename", (p) => p.rename("file", "other")],
    ["renameDirectory", (p) => p.renameDirectory("dir", "other")],
    ["signed URL", (p) => p.getSignedUrl("file")],
  ];
  it.each(operations)("rechecks a redirected base during %s", async (_name, operation) => {
    const base = path.join(temp, "storage");
    const local = provider(base);
    // Populate the previous real-base cache too, to catch stale physical validation.
    await local.write("file", Buffer.from("fixture"));
    await fs.rename(base, path.join(temp, "old-storage"));
    await fs.symlink("/proc", base);
    await expect(operation(local)).rejects.toThrow(/prohibited/);
  });

  it("enforces policy even when provider construction/configuration is bypassed", async () => {
    const local = provider();
    Object.assign(local, { basePath: "/etc" });
    for (const [, operation] of operations) {
      await expect(operation(local)).rejects.toThrow(/prohibited/);
    }
  });

  it("retains traversal and symlink containment, on both rename endpoints", async () => {
    const local = provider();
    await local.write("file", Buffer.from("fixture"));
    const base = path.join(temp, "storage");
    await fs.mkdir(path.join(temp, "outside"));
    await fs.writeFile(path.join(temp, "outside", "file"), "outside fixture");
    await fs.symlink(path.join(temp, "outside"), path.join(base, "escape"));
    await fs.symlink("/proc", path.join(base, "sensitive"));
    await fs.symlink(path.join(base, "file"), path.join(base, "file-link"));
    await expect(local.write("../outside/file", Buffer.from("fixture"))).rejects.toBeInstanceOf(FilePathTraversalError);
    await expect(local.write("escape/file", Buffer.from("fixture"))).rejects.toBeInstanceOf(FilePathTraversalError);
    await expect(local.read("file-link")).rejects.toBeInstanceOf(FilePathTraversalError);
    await expect(local.list({ prefix: "../outside" })).rejects.toBeInstanceOf(FilePathTraversalError);
    for (const rename of [local.rename.bind(local), local.renameDirectory.bind(local)]) {
      await expect(rename("sensitive/future", "other")).rejects.toThrow(/prohibited/);
      await expect(rename("file", "sensitive/future")).rejects.toThrow(/prohibited/);
      await expect(rename("escape/file", "other")).rejects.toBeInstanceOf(FilePathTraversalError);
      await expect(rename("file", "escape/file")).rejects.toBeInstanceOf(FilePathTraversalError);
    }
    expect((await local.list()).entries.map((e) => e.path)).toEqual(["file"]);
    expect((await local.list({ delimiter: true })).entries.map((e) => e.path)).toEqual(["file"]);
    expect(await fs.readFile(path.join(base, "file"), "utf8")).toBe("fixture");
  });
});

it("rejects startup and failed registry reloads atomically, reporting the bad filesystem", async () => {
  setEnvironmentVariableOverride("FILESYSTEMS", () => JSON.stringify(config(path.join(temp, "active"))));
  initFileSystems();
  const active = getFileSystemProvider("test");
  setEnvironmentVariableOverride("FILESYSTEMS", () => JSON.stringify({
    ...config(path.join(temp, "candidate"), "candidate"),
    ...config("/proc", "forbidden"),
  }));
  expect(() => initFileSystems()).toThrow(/FILESYSTEMS.*forbidden.*prohibited/);
  expect(getFileSystemProvider("test")).toBe(active);
  const [result] = await runReloads(["filesystems"]);
  expect(result).toMatchObject({ id: "filesystems", ok: false });
  expect(result.message).toMatch(/forbidden.*prohibited/);
  expect(listFileSystemConfigs().map((c) => c.id)).toEqual(["test"]);
  expect(getFileSystemProvider("test")).toBe(active);
  setEnvironmentVariableOverride("FILESYSTEMS", () => JSON.stringify(config(path.join(temp, "replacement"))));
  const [success] = await runReloads(["filesystems"]);
  expect(success.ok).toBe(true);
  expect(getFileSystemProvider("test")).not.toBe(active);
});
