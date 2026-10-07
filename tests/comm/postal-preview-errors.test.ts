import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ render: vi.fn(), log: vi.fn() }));
vi.mock("../../server/services/comm/letter-pdf", () => ({ renderLetterPdf: mocks.render }));
vi.mock("../../server/modules/masquerade", () => ({ getEffectiveUser: async () => ({ dbUser: { id: "staff" } }) }));
vi.mock("../../server/flood/service", () => ({
  checkFlood: async () => ({ allowed: true }), recordFloodEvent: async () => {},
}));
vi.mock("../../server/logger", () => ({ logger: { error: mocks.log, warn: mocks.log } }));
import { registerCommPostalPreviewRoutes } from "../../server/modules/comm-postal-preview";
import { LetterImageError } from "../../server/services/comm/letter-image-error";
import { MaintenanceModeError } from "../../server/services/maintenance-flag";

describe("safe actionable postal preview failures", () => {
  let server: Server;
  let origin: string;
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    registerCommPostalPreviewRoutes(app, (_req, _res, next) => next(), () => (_req, _res, next) => next());
    server = await new Promise<Server>((resolve) => {
      const running = app.listen(0, "127.0.0.1", () => resolve(running));
    });
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); });
  beforeEach(() => { mocks.render.mockReset(); mocks.log.mockClear(); });
  const preview = () => fetch(`${origin}/api/comm/postal/preview`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ body: "<p>private-letter-canary</p>" }),
  });

  it("returns the image number and controlled refusal, already displayed by LetterPagePreview", async () => {
    mocks.render.mockRejectedValue(new LetterImageError("unsafe-svg", "SVG external resources are not allowed.", 3));
    const response = await preview();
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ message: "Could not load letter image 3: SVG external resources are not allowed." });
  });
  it("does not expose unexpected browser errors or private URLs", async () => {
    mocks.render.mockRejectedValue(new Error("https://user:password@example.com/?signature=private-letter-canary"));
    const response = await preview();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ message: "Unable to generate the PDF preview" });
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/password|signature|canary/);
  });
  it("preserves maintenance refusal rather than masking it as image failure", async () => {
    mocks.render.mockRejectedValue(new MaintenanceModeError("Lob", "download letter images"));
    const response = await preview();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ maintenance: true });
  });
  it("returns PDF bytes through the existing shared rendering path", async () => {
    mocks.render.mockResolvedValue(Buffer.from("%PDF-test"));
    const response = await preview();
    expect(response.headers.get("content-type")).toContain("application/pdf");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe("%PDF-test");
    expect(mocks.render).toHaveBeenCalledWith("<p>private-letter-canary</p>", { previewGuides: true });
  });
});
