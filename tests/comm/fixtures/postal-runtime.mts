import assert from "node:assert/strict";
import express from "express";
import { writeFile, mkdir } from "node:fs/promises";
import { renderLetterPdf } from "../../../server/services/comm/letter-pdf";
import { registerMessageDefaultsRoutes } from "../../../server/modules/message-defaults";
import { registerCommPostalPreviewRoutes } from "../../../server/modules/comm-postal-preview";
import puppeteer from "puppeteer-core";
// @ts-expect-error Test-only JavaScript I/O boundaries shared with the Node loader.
import { saved, logs } from "./postal-runtime-stubs.mjs";

const out = process.argv[2];
await mkdir(out, { recursive: true });
const app = express();
app.use(express.json());
registerMessageDefaultsRoutes(app, "postal");
registerMessageDefaultsRoutes(app, "email");
registerCommPostalPreviewRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
const server = app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
try {
  // Exercise delivery first so a regression retains the synthetic browser stack,
  // rather than only seeing the intentionally redacted HTTP response.
  await writeFile(`${out}/unbranded.pdf`, await renderLetterPdf("<p>SHORTBODY</p>"));
  const call = async (path: string, payload: unknown) => fetch(origin + path, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
  });
  const defaults = { letterheadHtml: "<p>DRAFTHEAD</p>", footerHtml: "<p>DRAFTFOOT</p>", showPageCount: true };
  const settings = await call("/api/config/postal/message-defaults/preview", defaults);
  assert.equal(settings.status, 200, await (settings.clone()).text());
  await writeFile(`${out}/settings.pdf`, Buffer.from(await settings.arrayBuffer()));
  const studio = await call("/api/comm/postal/preview", { body: "<p>STUDIOBODY</p><p style=\"break-before:page\">CONTINUATION</p>" });
  assert.equal(studio.status, 200, await (studio.clone()).text());
  await writeFile(`${out}/studio.pdf`, Buffer.from(await studio.arrayBuffer()));
  const image = '<img src="https://synthetic.example.invalid/logo.png" width="10">';
  await writeFile(`${out}/delivery.pdf`, await renderLetterPdf(`<p>DELIVERYBODY</p>${image}`, { defaults }));
  for (const [name, branding] of Object.entries({
    empty: { letterheadHtml: "", footerHtml: "", showPageCount: false },
    head: { ...defaults, footerHtml: "", showPageCount: false },
    foot: { ...defaults, letterheadHtml: "", showPageCount: false },
    counts: { letterheadHtml: "", footerHtml: "", showPageCount: true },
    combined: defaults,
  })) {
    for (const multi of [false, true]) {
      await writeFile(`${out}/${name}-${multi ? "multi" : "short"}.pdf`, await renderLetterPdf(
        `<p>FIRSTBODY</p>${multi ? '<p style="break-before:page">SECONDBODY</p>' : ""}`,
        { defaults: branding },
      ));
    }
  }
  for (const path of ["/api/config/postal/message-defaults/preview", "/api/comm/postal/preview"]) {
    const refusal = await call(path, path.includes("/config/")
      ? { ...defaults, footerHtml: '<p style="font-size:100pt">Oversized</p>' }
      : { body: '<table style="width:900px"><tr><td>Oversized</td></tr></table>' });
    assert.equal(refusal.status, 422);
    assert.match((await refusal.json()).message, /Reduce/);
  }
  const before = JSON.stringify([...saved]);
  const email = await call("/api/config/email/message-defaults/preview", { letterheadHtml: "<p>EMAILDRAFT</p>" });
  assert.equal(email.status, 200);
  assert.match((await email.json()).html, /EMAILDRAFT/);
  const launch = puppeteer.launch;
  const canary = "https://private.invalid/?signature=private-html-canary";
  puppeteer.launch = async () => { throw Object.assign(new Error(canary), { name: canary }); };
  try {
    for (const path of ["/api/config/postal/message-defaults/preview", "/api/comm/postal/preview"]) {
      const failure = await call(path, path.includes("/config/") ? defaults : { body: "<p>Body</p>" });
      assert.equal(failure.status, 500);
      assert.deepEqual(await failure.json(), { message: "Unable to generate the PDF preview" });
    }
    assert.doesNotMatch(JSON.stringify(logs), /private\.invalid|signature|private-html-canary/);
  } finally { puppeteer.launch = launch; }
  assert.equal(JSON.stringify([...saved]), before, "Preview must not mutate saved defaults");
  console.log("PASS: real renderer, settings draft and saved-defaults postal preview");
} catch (error) {
  // Synthetic content only. This diagnostic is intentionally local to this test.
  console.error(error instanceof Error ? error.stack : "Synthetic runtime failure");
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
