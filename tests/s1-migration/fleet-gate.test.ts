import { describe, expect, it } from "vitest";
import { FLEET, fleetGateStatus, PROFILES } from "../../scripts/s1-migration/sync-config";
import { buildLoaderResult, emptySummary, loaderExitCode } from "../../scripts/s1-migration/lib/sync";
import { RejectLog } from "../../scripts/s1-migration/lib/loader-utils";

const passing = FLEET.map(({ id }) => ({ id, status: "pass" }));
const skippedSeeders = passing.map((record) =>
  record.id === "seed-trust-config" || record.id === "seed-policy-benefits"
    ? { ...record, status: "skipped" }
    : record,
);

describe("sync fleet gate", () => {
  it("admits only the two ruled file rejects in the production daily fleet", () => {
    const allowedRejects = PROFILES.production.steps.files.allowRejects;
    expect(allowedRejects).toEqual(["bytes_missing", "owner_unresolved"]);
    expect(PROFILES.dev.steps.files.allowRejects).toBeUndefined();
    for (const other of [undefined, "category_unruled", "extension_disallowed",
      "owner_missing", "source_json_invalid", "merge_unresolved"]) {
      const rejects = new RejectLog();
      for (const reason of ["bytes_missing", "owner_unresolved", ...(other ? [other] : [])])
        rejects.add(reason, { fid: 1 }, 1);
      const result = buildLoaderResult({ loader: "s1-files", logicVersion: 1, dryRun: false,
        forceReconcile: false, summary: emptySummary(), rejects, allowedRejects, verifyFailures: 0 });
      expect(loaderExitCode(result)).toBe(other ? 1 : 0);
      expect(fleetGateStatus(passing.map(r => r.id === "files"
        ? { ...r, status: loaderExitCode(result) ? "fail" : "pass" } : r), "daily", false))
        .toBe(other ? "fail" : "pass");
    }
  });
  it("passes only the operator-approved employer-upload reject reasons in both profiles", () => {
    const expected = ["missing_upload_parent", "missing_employer_node"];
    expect(PROFILES.dev.steps["employer-wizards"].allowRejects).toEqual(expected);
    expect(PROFILES.production.steps["employer-wizards"].allowRejects).toEqual(expected);
    expect(expected).not.toContain("unsupported_source_type");
  });

  it("accepts precisely the two intentionally skipped daily seeders", () => {
    expect(fleetGateStatus(skippedSeeders, "daily", true)).toBe("pass");
    expect(fleetGateStatus(passing, "daily", false)).toBe("pass");
  });

  it("refuses skips without authorization, missing records, or failures", () => {
    expect(fleetGateStatus(skippedSeeders, "daily", false)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders, "daily", true, "elections")).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.slice(0, -1), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.map((r) => r.id === "elections" ? { ...r, status: "skipped" } : r), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.map((r) => r.id === "elections" ? { ...r, status: "fail" } : r), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders.map((r) => r.id === "elections" ? { ...r, id: "wrong" } : r), "daily", true)).toBe("fail");
    expect(fleetGateStatus(skippedSeeders, "final-freeze", false)).toBe("fail");
  });
});