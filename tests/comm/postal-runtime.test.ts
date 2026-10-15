import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import { PDFDocument } from "pdf-lib";
import { expect, it } from "vitest";

const exec = promisify(execFile);
const fixture = path.resolve("tests/comm/fixtures/postal-runtime.mts");
const stub = path.resolve("tests/comm/fixtures/postal-runtime-stubs.mjs");
const boundaries = [
  "server/config/env-registry", "server/logger", "server/storage",
  "server/services/access-policy-evaluator", "server/modules/masquerade",
  "server/flood/service", "server/flood/events", "server/services/comm/letter-images",
];

it("renders real Chromium PDFs through tsx and the production bundle, not Vitest's transform", async () => {
  // Under node_modules so generated bundles can resolve external dependencies;
  // mkdtemp and finally cleanup keep outputs out of Git/deployment.
  const dir = await mkdtemp(path.resolve("node_modules/.postal-runtime-"));
  try {
    await build({
      entryPoints: [fixture], outdir: path.join(dir, "bundle"),
      platform: "node", packages: "external", bundle: true, format: "esm", splitting: true,
      plugins: [{
        name: "isolate-io-only",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            const normalized = path.resolve(args.resolveDir, args.path).replace(/\.(ts|js)$/, "");
            return boundaries.some((name) => normalized.endsWith(`/${name}`)) ? { path: stub } : undefined;
          });
        },
      }],
    });
    for (const runtime of ["development", "production"]) {
      const out = path.join(dir, runtime);
      const args = runtime === "development"
        ? ["--import", "tsx", "--import", "./tests/comm/fixtures/postal-runtime-register.mjs", fixture, out]
        : [path.join(dir, "bundle/postal-runtime.js"), out];
      const result = await exec(process.execPath, args, { timeout: 240_000, maxBuffer: 100_000 });
      expect(result.stdout).toContain("PASS");
      const text = async (name: string) => (await exec("pdftotext", ["-layout", path.join(out, `${name}.pdf`), "-"])).stdout;
      for (const name of ["empty", "head", "foot", "counts", "combined"]) {
        for (const length of ["short", "multi"]) {
          const file = `${name}-${length}`;
          const count = length === "short" ? 1 : 2;
          const pdf = await PDFDocument.load(await readFile(path.join(out, `${file}.pdf`)));
          expect(pdf.getPageCount()).toBe(count);
          expect(pdf.getPages().map((page) => page.getSize())).toEqual(Array(count).fill({ width: 612, height: 792 }));
          const content = await text(file);
          expect(content.match(/DRAFTHEAD/g)?.length ?? 0).toBe(["head", "combined"].includes(name) ? 1 : 0);
          expect(content.match(/DRAFTFOOT/g)?.length ?? 0).toBe(["foot", "combined"].includes(name) ? count : 0);
          expect(content.match(/Page \d of \d/g)?.length ?? 0).toBe(["counts", "combined"].includes(name) ? count : 0);
          if (["counts", "combined"].includes(name)) expect(content).toContain(`Page ${count} of ${count}`);
          expect(content).not.toContain("Reserved for Lob");
        }
      }
      const settings = await text("settings");
      expect(settings).toContain("DRAFTHEAD");
      expect(settings).not.toContain("SAVEDHEAD");
      expect(settings.match(/DRAFTFOOT/g)).toHaveLength(2);
      expect(settings).toContain("Reserved for Lob");
      const studio = await text("studio");
      expect(studio).toContain("STUDIOBODY");
      expect(studio.match(/SAVEDHEAD/g)).toHaveLength(1);
      expect(studio.match(/SAVEDFOOT/g)).toHaveLength(2);
      expect(studio).toContain("Page 2 of 2");
      const bbox = (await exec("pdftotext", ["-bbox", path.join(out, "combined-multi.pdf"), "-"])).stdout;
      for (const word of bbox.matchAll(/<word xMin="([^"]+)" yMin="([^"]+)" xMax="([^"]+)" yMax="([^"]+)">([^<]+)<\/word>/g)) {
        expect(Number(word[1])).toBeGreaterThanOrEqual(71.9);
        expect(Number(word[3])).toBeLessThanOrEqual(540.1);
        if (/BODY/.test(word[5])) expect(Number(word[4])).toBeLessThan(684.1);
        if (word[5] === "DRAFTHEAD") expect(Number(word[2])).toBeGreaterThan(215);
        if (word[5] === "DRAFTFOOT") expect(Number(word[4])).toBeLessThan(756.1);
      }
    }
  } finally { await rm(dir, { force: true, recursive: true }); }
}, 540_000);
