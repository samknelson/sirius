import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";
import { expect, it } from "vitest";

it("handles Twilio responses with native ESM and production-style external dependencies", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "twilio-native-esm-"));
  try {
    await symlink(path.resolve("node_modules"), path.join(dir, "node_modules"), "dir");
    const output = path.join(dir, "regression.mjs");
    await build({
      entryPoints: ["tests/webclient/fixtures/twilio-native-esm.ts"],
      bundle: true, platform: "node", packages: "external", format: "esm", outfile: output,
    });
    const result = spawnSync(process.execPath, [output], {
      encoding: "utf8", timeout: 15_000,
      // Do not inherit any loader that could mask native ESM interop.
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Native ESM Twilio connection, send, error and diagnostic contracts passed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
