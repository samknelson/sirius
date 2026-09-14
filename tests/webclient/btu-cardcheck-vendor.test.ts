import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { PluginConfig } from "@shared/schema";
import type { Browser, Page } from "puppeteer-core";
import {
  getWcVendorOperationManifest,
  getWcVendorPlugin,
  planLegacyBtuScrapeWcVendorConfig,
} from "../../server/plugins/wc-vendors";
import {
  BTU_CARDCHECK_PLUGIN_ID,
  BtuCardcheckRuntime,
} from "../../server/plugins/wc-vendors/plugins/btu-cardcheck";
import type { WcVendorContext } from "../../server/plugins/wc-vendors/types";

function context(
  password = "password-canary",
  configId = "btu-config",
): WcVendorContext {
  return {
    credential: { secretName: "BTU_TEST_PASSWORD", value: password },
    config: {
      id: configId,
      pluginKind: "wc-vendors",
      pluginId: BTU_CARDCHECK_PLUGIN_ID,
      enabled: true,
      ordering: 0,
      data: {
        siteUrl: "https://btu.example.test",
        username: "scrape-user",
        chromiumPath: "/test/chromium",
      },
    } as PluginConfig,
  };
}

async function validPdf(): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.addPage();
  return document.save();
}

function browserFixture(options?: {
  loginError?: string | null;
  typeError?: Error;
  attachedPdfUrls?: string[];
}) {
  const evaluations: unknown[] = [
    true,
    options?.loginError ?? null,
    options?.attachedPdfUrls ?? [],
  ];
  const page = {
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => evaluations.shift()),
    title: vi.fn(async () => "BTU Card Check"),
    type: vi.fn(async () => {
      if (options?.typeError) throw options.typeError;
    }),
    waitForNavigation: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    pdf: vi.fn(async () => validPdf()),
    cookies: vi.fn(async () => []),
  } as unknown as Page;
  const browser = {
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => undefined),
  } as unknown as Browser;
  return { page, browser };
}

describe("BTU card-check vendor declaration", () => {
  it("declares only browser-free, uncached operations behind the BTU guard", () => {
    expect(BTU_CARDCHECK_PLUGIN_ID).toBe("sitespecific-btu-cardcheck");
    expect(getWcVendorPlugin("btu-cardcheck")).toBeUndefined();
    const plugin = getWcVendorPlugin(BTU_CARDCHECK_PLUGIN_ID);
    expect(plugin).toMatchObject({
      service: "BTU",
      requiredComponent: "sitespecific.btu",
      credential: { secretName: "required" },
    });
    expect(getWcVendorOperationManifest(plugin!)).toEqual([
      {
        id: "login",
        description: "sign in to the BTU site",
        needsWritableDatabase: true,
        cacheMode: "uncached",
      },
      {
        id: "fetch-cardcheck",
        description: "fetch a card check page from the BTU site",
        needsWritableDatabase: true,
        cacheMode: "uncached",
      },
    ]);
    expect(JSON.stringify(plugin)).not.toContain("run");
  });
});

describe("BTU legacy connection migration plan", () => {
  it("stores only the password secret name and non-secret settings", () => {
    const plan = planLegacyBtuScrapeWcVendorConfig({
      hasExistingConfig: false,
      username: " legacy-user ",
      passwordSecretIsSet: true,
    });
    expect(plan).toMatchObject({
      secretName: "BTU_SCRAPER_PASSWORD",
      siteUrl: "https://sirius-btu.activistcentral.net",
      username: "legacy-user",
      chromiumPath: expect.any(String),
    });
    expect(JSON.stringify(plan)).not.toContain("password-canary");
  });

  it("leaves existing rows untouched and refuses incomplete legacy settings", () => {
    expect(planLegacyBtuScrapeWcVendorConfig({
      hasExistingConfig: true,
      username: "legacy-user",
      passwordSecretIsSet: true,
    })).toBeNull();
    expect(planLegacyBtuScrapeWcVendorConfig({
      hasExistingConfig: false,
      username: "",
      passwordSecretIsSet: true,
    })).toBeNull();
    expect(planLegacyBtuScrapeWcVendorConfig({
      hasExistingConfig: false,
      username: "legacy-user",
      passwordSecretIsSet: false,
    })).toBeNull();
  });
});

describe("BTU browser session runtime", () => {
  it("returns only serializable session/PDF data and closes the browser", async () => {
    const fixture = browserFixture();
    const runtime = new BtuCardcheckRuntime();
    const ctx = context();

    const login = await runtime.login(ctx, fixture.browser);
    expect(login).toEqual({ sessionId: expect.any(String) });
    expect(JSON.stringify(login)).not.toContain("password-canary");
    expect(runtime.activeSessionCount()).toBe(1);

    const fetched = await runtime.fetchCardcheck(ctx, {
      sessionId: login.sessionId,
      nid: "123",
    });
    expect(fetched).toEqual({ pdfBase64: expect.any(String) });
    expect(Buffer.from(fetched.pdfBase64, "base64").length).toBeGreaterThan(100);
    expect(JSON.stringify(fetched)).not.toContain("password-canary");

    await runtime.close(login.sessionId);
    expect(runtime.activeSessionCount()).toBe(0);
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });

  it("closes failed logins and redacts credentials from browser errors", async () => {
    const fixture = browserFixture({
      typeError: new Error("could not type password-canary for scrape-user"),
    });
    const runtime = new BtuCardcheckRuntime();
    const error = await runtime.login(
      context(),
      fixture.browser,
    ).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).toContain("[REDACTED]");
    expect(String(error)).not.toContain("password-canary");
    expect(String(error)).not.toContain("scrape-user");
    expect(runtime.activeSessionCount()).toBe(0);
    expect(fixture.browser.close).toHaveBeenCalledTimes(1);
  });

  it("binds opaque sessions to the connection that created them", async () => {
    const fixture = browserFixture();
    const runtime = new BtuCardcheckRuntime();
    const login = await runtime.login(context(), fixture.browser);
    await expect(runtime.fetchCardcheck(
      context("password-canary", "different-config"),
      { sessionId: login.sessionId, nid: "123" },
    )).rejects.toThrow("different connection");
    await runtime.close(login.sessionId);
  });

  it("never fetches cross-origin attachments or follows redirects off site", async () => {
    const fixture = browserFixture({
      attachedPdfUrls: [
        "https://evil.example.test/stolen.pdf",
        "https://btu.example.test/redirect.pdf",
      ],
    });
    const runtime = new BtuCardcheckRuntime();
    const network = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }),
    );
    const ctx = context();
    const login = await runtime.login(ctx, fixture.browser);
    await expect(runtime.fetchCardcheck(ctx, {
      sessionId: login.sessionId,
      nid: "123",
    })).resolves.toEqual({ pdfBase64: expect.any(String) });

    expect(network).toHaveBeenCalledTimes(1);
    expect(String(network.mock.calls[0][0])).toBe(
      "https://btu.example.test/redirect.pdf",
    );
    expect(network.mock.calls[0][1]).toMatchObject({
      redirect: "manual",
      headers: { Cookie: "" },
    });
    await runtime.close(login.sessionId);
    network.mockRestore();
  });
});