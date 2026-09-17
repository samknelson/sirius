import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { assertFleetVersions } from "../../scripts/s1-migration/lib/fleet-version-check";
import { FLEET } from "../../scripts/s1-migration/sync-config";

describe("fleet version preflight", () => {
  it("matches every shipped loader to the orchestrator expectation", () => {
    assertFleetVersions(FLEET, fileURLToPath(new URL("../../scripts/s1-migration/", import.meta.url)));
  });

  it("reports all version mismatches in one refusal without executing loaders", () => {
    const steps = [
      { id: "a", script: "a.ts", logicVersion: 1 },
      { id: "b", script: "b.ts", logicVersion: 2 },
    ];
    expect(() => assertFleetVersions(steps, "/unused", () => "const LOGIC_VERSION = 3;\nthrow new Error('do not execute');"))
      .toThrow(/before staging: a: loader logicVersion 3.*b: loader logicVersion 3/);
  });

  it("fails closed on missing, ambiguous or nonliteral versions and unreadable files", () => {
    const steps = [{ id: "a", script: "a.ts", logicVersion: 1 }];
    for (const source of ["", "const LOGIC_VERSION = other;", "const LOGIC_VERSION = 1;\nconst LOGIC_VERSION = 1;"]) {
      expect(() => assertFleetVersions(steps, "/unused", () => source)).toThrow(/expected one literal/);
    }
    expect(() => assertFleetVersions(steps, "/unused", () => { throw new Error("missing"); }))
      .toThrow(/cannot read a.ts/);
  });
});