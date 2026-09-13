import { describe, expect, it } from "vitest";

import {
  auditListedTransportFixture,
  auditWcVendorHandlerFixture,
  findTransportCallTexts,
} from "../../scripts/dev/check-maintenance-guards";

describe("maintenance guard transport reachability", () => {
  it("finds fetch aliases and dynamically loaded SDK transports", () => {
    const calls = findTransportCallTexts(`
      const request = globalThis.fetch;
      async function listed() {
        await request("https://example.invalid");
      }
      async function alsoListed() {
        const { default: got } = await import("got");
        await got("https://example.invalid");
      }
    `);

    expect(calls).toEqual(
      expect.arrayContaining([
        'request("https://example.invalid")',
        'import("got")',
        'got("https://example.invalid")',
      ]),
    );
  });

  it("reports a dynamic SDK transport outside an audited plugin handler", () => {
    const violations = auditWcVendorHandlerFixture(
      `
        const operations = {
          allowed: {
            run: async () => ({ ok: true }),
          },
        };

        async function unsafeMetadataHook() {
          const got = require("got");
          return got("https://example.invalid");
        }

        registerWcVendorPlugin({
          id: "fixture",
          operations,
        });
      `,
      {
        handlerContainers: ["operations"],
        handlerProperty: "run",
        vendorIdentifiers: ["fetch"],
      },
    );

    expect(violations.some((violation) =>
      violation.detail.includes("unsafeMetadataHook()") &&
      violation.detail.includes("not reachable from"),
    )).toBe(true);
  });

  it("does not inherit an exempt loader's reason in a listed-module caller", () => {
    const violations = auditListedTransportFixture(
      `
        async function loader() {
          const got = require("got");
          return got("https://example.invalid");
        }
        async function deleteRemote() {
          return loader();
        }
      `,
      {
        loader: "The configured file-transfer loader owns this intentional transport.",
      },
    );

    expect(violations.some((violation) =>
      violation.detail.includes("deleteRemote()") &&
      violation.detail.includes("does not go through"),
    )).toBe(true);
    expect(violations.some((violation) => violation.detail.includes("loader()"))).toBe(false);
  });
});