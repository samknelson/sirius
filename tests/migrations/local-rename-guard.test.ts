import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const roots: string[] = [];
const checker = resolve("scripts/check-migrations.ts");
const tsx = resolve("node_modules/tsx/dist/cli.mjs");
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture(directory: string) {
  const root = mkdtempSync(join(tmpdir(), "migration-rename-"));
  roots.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  const write = (version: number, name: string) => {
    const file = join(root, directory, `${version}_${name}.ts`);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `export default { version: ${version}, };\n`);
    return file;
  };
  git("init");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Migration fixture");
  write(100, "base");
  git("add", ".");
  git("commit", "-m", "base");
  git("branch", "deployment");
  const old = write(102, "old");
  git("add", ".");
  git("commit", "-m", "new migration");
  const run = () => {
    const result = spawnSync(process.execPath, [tsx, checker, "--base=deployment", "--skip"], {
      cwd: root, encoding: "utf8", timeout: 20_000,
    });
    return { status: result.status, output: result.stdout + result.stderr };
  };
  return { root, git, write, old, run };
}

describe.each(["scripts/migrate/core", "scripts/migrate/components/example"])("%s rename validation", directory => {
  it("ignores a deleted old path during a local unstaged rename", () => {
    const f = fixture(directory);
    renameSync(f.old, join(dirname(f.old), "101_renamed.ts"));
    const result = f.run();
    expect(result.output).not.toContain("FAILED");
    expect(result.status).toBe(0);
  });

  it("accepts the same rename when staged", () => {
    const f = fixture(directory);
    renameSync(f.old, join(dirname(f.old), "101_renamed.ts"));
    f.git("add", "-A");
    expect(f.run().status).toBe(0);
  });

  it("rejects a Git-recognized staged rename below the deployment floor", () => {
    const f = fixture(directory);
    renameSync(f.old, join(dirname(f.old), "99_renamed.ts"));
    f.git("add", "-A");
    expect(f.git("diff", "--cached", "--name-status", "-M").toString()).toMatch(/^R100\s/m);
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("max existing");
  });

  it("rejects a committed rename below the deployment floor", () => {
    const f = fixture(directory);
    renameSync(f.old, join(dirname(f.old), "99_renamed.ts"));
    f.git("add", "-A");
    f.git("commit", "-m", "renamed");
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("max existing");
  });

  it("still rejects duplicate live new versions", () => {
    const f = fixture(directory);
    f.write(102, "duplicate");
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("duplicates");
  });

  it("retains the deployment floor even when that path is deleted locally", () => {
    const f = fixture(directory);
    rmSync(f.old);
    rmSync(join(f.root, directory, "100_base.ts"));
    f.write(99, "too_low");
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.output).toContain("max existing");
  });
});
