import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { workerTabTree, userTabTree } from "@shared/tabRegistry";
import { CommList } from "@/components/worker/CommList";
import { registerCommRoutes } from "../../server/modules/comm";

const appSource = readFileSync(new URL("../../client/src/App.tsx", import.meta.url), "utf8");

describe("manual interaction retirement", () => {
  it.each([
    ["worker", workerTabTree, "/workers"],
    ["user", userTabTree, "/users"],
  ])("keeps %s Comm navigation for history and sends, not Log Call", (_name, tree, prefix) => {
    const children = tree.find((tab) => tab.id === "comm")?.children ?? [];
    expect(children.map((tab) => tab.id)).toEqual([
      "comm-history", "send-sms", "send-email", "send-postal", "send-inapp",
    ]);
    expect(children[0].hrefTemplate).toBe(`${prefix}/{id}/comm/history`);
  });

  it.each(["workers", "users"])("redirects the old %s URL to protected history", (entity) => {
    const route = appSource.match(
      new RegExp(`<Route path="/${entity}/:id/comm/log-call">([\\s\\S]*?)<\\/Route>`),
    )?.[1];
    expect(route).toBeDefined();
    expect(route).toContain(`<Redirect to={\`/${entity}/\${params.id}/comm/history\`} />`);
    expect(route).not.toContain("LogCall");
    expect(appSource).toContain(`<Route path="/${entity}/:id/comm/history">`);
    expect(appSource).toContain(`<ProtectedRoute tabId="comm-history" entityType="${entity === "workers" ? "worker" : "user"}">`);
  });

  it("still renders historical interactions and their detail link", () => {
    const html = renderToStaticMarkup(
      <Router hook={() => ["/", () => {}]}><CommList records={[{
        id: "historic-interaction",
        contactId: "contact",
        medium: "interaction",
        status: "received",
        sent: "2024-01-01T12:00:00Z",
        received: null,
        data: null,
        interactionDetails: {
          id: "detail", commId: "historic-interaction", channel: "phone",
          callReasonId: "reason", reasonName: "Benefit question", notes: "Called back",
          data: null,
        },
      }]} /></Router>,
    );
    expect(html).toContain("Benefit question");
    expect(html).toContain("/comm/historic-interaction");
  });
});

describe("retired interaction endpoint", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    const pass = (_req: any, _res: any, next: () => void) => next();
    registerCommRoutes(app, pass, () => pass, () => pass);
    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test listener");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it("rejects a direct POST before it can write, even with valid-looking input", async () => {
    const response = await fetch(`${baseUrl}/api/contacts/00000000-0000-4000-8000-000000000000/interaction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "phone",
        callReasonId: "00000000-0000-4000-8000-000000000001",
        notes: "Must not be saved",
      }),
    });
    expect(response.status).toBe(410);
  });

  it("retains history/detail reads and the other send routes", () => {
    const paths = (appSource.match(/<Route path="[^"]*\/comm\/[^"]*"/g) ?? []).join("\n");
    for (const entity of ["workers", "users"]) {
      for (const action of ["history", "send-sms", "send-email", "send-postal", "send-inapp"]) {
        expect(paths).toContain(`/${entity}/:id/comm/${action}`);
      }
    }
    const moduleSource = readFileSync(new URL("../../server/modules/comm.ts", import.meta.url), "utf8");
    expect(moduleSource).toContain('app.get("/api/contacts/:contactId/comm"');
    expect(moduleSource).toContain('app.get("/api/comm/:id"');
    for (const action of ["sms", "email", "postal", "inapp"]) {
      expect(moduleSource).toContain(`app.post("/api/contacts/:contactId/${action}"`);
    }
  });
});