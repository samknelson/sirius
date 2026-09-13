import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { findViolations } from "../../scripts/dev/check-maintenance-guards";

const SERVICE_FIXTURE =
  "server/services/__plugin-only-enforcement-fixture.ts";
const PLUGIN_FIXTURE =
  "server/plugins/wc-vendors/plugins/__plugin-only-enforcement-fixture.ts";

afterEach(() => {
  for (const file of [SERVICE_FIXTURE, PLUGIN_FIXTURE]) {
    if (existsSync(file)) unlinkSync(file);
  }
});

describe.sequential("plugin-only transport enforcement", () => {
  it("rejects service-owned registration, alternate handler access, and indirect transports", () => {
    writeFileSync(
      SERVICE_FIXTURE,
      [
        'import * as framework from "./webclient/registry";',
        'export { getWcVendorHandler as rawHandler } from "../plugins/wc-vendors/registry";',
        'import axios from "axios";',
        'const got = require("got");',
        'void import("playwright-core");',
        "const send = fetch;",
        'framework.registerWcRequest({ service: "X" });',
        'void import("./webclient/registry").then((value) => value.registerWcRequest);',
        'void import("../plugins/wc-vendors/registry").then((value) => value.getWcVendorHandler);',
        'void send("https://vendor.invalid");',
        'void globalThis.fetch("https://vendor.invalid");',
        'void axios.get("https://vendor.invalid");',
        'void got("https://vendor.invalid");',
      ].join("\n"),
    );

    const fixtureViolations = findViolations().filter(
      ({ file }) => file === SERVICE_FIXTURE,
    );
    const details = fixtureViolations.map(({ detail }) => detail).join("\n");

    expect(details).toContain("registerWcRequest");
    expect(details).toContain("getWcVendorHandler");
    expect(details).toMatch(/fetch transport|alias of the fetch transport/);
    expect(details).toContain("vendor or browser transport SDK");
  });

  it("fails closed when a new transport-bearing vendor plugin lacks a handler audit", () => {
    writeFileSync(
      PLUGIN_FIXTURE,
      [
        'import { registerWcVendorPlugin } from "../registry";',
        "const handlers = {",
        '  ping: { async run() { return fetch("https://vendor.invalid"); } },',
        "};",
        "registerWcVendorPlugin({",
        '  id: "fixture-vendor",',
        '  name: "Fixture Vendor",',
        '  service: "Fixture",',
        "  operations: handlers,",
        "} as never);",
      ].join("\n"),
    );

    const violation = findViolations().find(
      ({ file, detail }) =>
        file === PLUGIN_FIXTURE &&
        detail.includes("HANDLERS_ON_FRAMEWORK reachability specification"),
    );

    expect(violation).toBeDefined();
  });

  it("does not confuse same-named imports from unrelated modules with framework access", () => {
    writeFileSync(
      SERVICE_FIXTURE,
      [
        'import { registerWcRequest } from "./some-unrelated-module";',
        "registerWcRequest();",
      ].join("\n"),
    );

    expect(
      findViolations().filter(({ file }) => file === SERVICE_FIXTURE),
    ).toEqual([]);
  });
});