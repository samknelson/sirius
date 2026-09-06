/**
 * Values this process plants in its OWN environment (Task #1390).
 *
 * The reported defect: a time zone set in the app took effect, and the
 * Environment page then reported it as coming from the deployment, warned the
 * stored value was shadowed, and refused further edits. Nothing had set TZ in
 * the environment — the app itself writes the resolved zone into `process.env`
 * at boot, because `Date`, `Intl` and the cron scheduler read it from nowhere
 * else, and everything downstream read that write back as proof a deployer had
 * supplied it.
 *
 * So the tests here are about a single distinction: who put the value in the
 * process environment. They cover it at the registry, through the boot step
 * that plants the zone, and at the two reporting surfaces that got it wrong.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getConfiguredEnvironmentValue,
  getEnvironmentVariable,
  getRawProcessEnv,
  isEnvironmentValuePlantedFromOverride,
  isEnvironmentVariableSetInProcess,
  listEnvironmentVariables,
  registerEnvironmentVariable,
  setEnvironmentVariable,
  setEnvironmentVariableOverrideSource,
} from "../../server/config/env-registry";
import { applySystemTimeZone } from "../../server/config/system-timezone";
import {
  ENV_VALUE_UNSET,
  fingerprintEnvironmentValue,
} from "../../server/config/env-value-fingerprint";

const STORED_ZONE = "America/Chicago";
const DEPLOYMENT_ZONE = "Asia/Tokyo";

/** What the page shows for one variable. */
function pageRow(name: string) {
  const row = listEnvironmentVariables().find((v) => v.name === name);
  expect(row, `${name} missing from the environment listing`).toBeTruthy();
  return row!;
}

/**
 * The Environment page's own warning, reproduced from the one line in the
 * admin route that computes it: a stored value that a deployment value is
 * beating. Duplicated rather than imported because the route needs a database
 * and an authenticated request, and this is the whole of the logic.
 */
function shadowWarningShown(name: string, storedNames: Set<string>): boolean {
  return pageRow(name).source === "environment" && storedNames.has(name);
}

/** Stand in for the in-app override store holding exactly these values. */
function installStore(values: Record<string, string>): void {
  setEnvironmentVariableOverrideSource((name) => values[name]);
}

describe("a value the app plants from a stored one", () => {
  const env = getRawProcessEnv();
  let savedTz: string | undefined;

  beforeEach(() => {
    savedTz = env.TZ;
    delete env.TZ;
    // Clear any marking left by an earlier test's plant.
    setEnvironmentVariable("TZ", "UTC", "environment");
    delete env.TZ;
    installStore({});
  });

  afterEach(() => {
    setEnvironmentVariableOverrideSource(null);
    setEnvironmentVariable("TZ", savedTz ?? "UTC", "environment");
    if (savedTz === undefined) delete env.TZ;
  });

  it("stays an in-app value: editable, unshadowed, and still applied", () => {
    installStore({ TZ: STORED_ZONE });

    // The boot step: nothing in the environment, a stored zone to honour.
    const applied = applySystemTimeZone(() => STORED_ZONE);
    expect(applied.configured, "the stored zone should have been applied").toBe(true);
    expect(applied.zone).toBe(STORED_ZONE);

    // It really is in the process environment — that is the mechanism, and it
    // has to keep working: the runtime reads the zone from there.
    expect(env.TZ, "the zone must reach the process environment").toBe(STORED_ZONE);
    expect(
      getEnvironmentVariable("TZ"),
      "the plain read must still report what the process is running on",
    ).toBe(STORED_ZONE);

    // ...and yet it is not a deployment value.
    expect(isEnvironmentValuePlantedFromOverride("TZ")).toBe(true);
    expect(
      isEnvironmentVariableSetInProcess("TZ"),
      "the check that locks saving must not treat the app's own write as the environment",
    ).toBe(false);

    const row = pageRow("TZ");
    expect(row.source, "the page should show an in-app value").toBe("override");
    expect(row.isSet).toBe(true);
    expect(row.overridable).toBe(true);
    expect(shadowWarningShown("TZ", new Set(["TZ"]))).toBe(false);
  });

  it("shows a new stored value, and reports it as waiting on a restart", () => {
    installStore({ TZ: STORED_ZONE });
    applySystemTimeZone(() => STORED_ZONE);
    const atBoot = fingerprintEnvironmentValue("TZ");

    // The operator edits the value on the page. The running process keeps the
    // zone it started in — the notice on the row says as much — but the page
    // must show what is now configured, not what the edit failed to change.
    installStore({ TZ: "Europe/Paris" });
    expect(getConfiguredEnvironmentValue("TZ")).toBe("Europe/Paris");
    expect(
      getEnvironmentVariable("TZ"),
      "the process is still running in the old zone until it restarts",
    ).toBe(STORED_ZONE);
    expect(
      fingerprintEnvironmentValue("TZ"),
      "a changed setting must register as waiting on a restart",
    ).not.toBe(atBoot);

    // Clearing it is the same story: configured becomes nothing at all.
    installStore({});
    expect(getConfiguredEnvironmentValue("TZ")).toBeUndefined();
    expect(pageRow("TZ").isSet, "a cleared value should not read as set").toBe(false);
    expect(fingerprintEnvironmentValue("TZ")).toBe(ENV_VALUE_UNSET);
  });

  it("a zone the deployment supplies still wins and still locks the row", () => {
    env.TZ = DEPLOYMENT_ZONE;
    installStore({ TZ: STORED_ZONE });

    const applied = applySystemTimeZone(() => STORED_ZONE);
    expect(applied.zone, "the deployment value must win").toBe(DEPLOYMENT_ZONE);
    expect(isEnvironmentValuePlantedFromOverride("TZ")).toBe(false);
    expect(isEnvironmentVariableSetInProcess("TZ")).toBe(true);

    const row = pageRow("TZ");
    expect(row.source).toBe("environment");
    expect(
      shadowWarningShown("TZ", new Set(["TZ"])),
      "the stored value really is shadowed here, and should say so",
    ).toBe(true);
  });

  it("a deployment-sourced write clears an earlier planted marking", () => {
    installStore({ TZ: STORED_ZONE });
    applySystemTimeZone(() => STORED_ZONE);
    expect(isEnvironmentValuePlantedFromOverride("TZ")).toBe(true);

    // Re-planted from the environment, e.g. a later boot of the same process
    // image where the deployment now supplies the zone.
    setEnvironmentVariable("TZ", DEPLOYMENT_ZONE, "environment");
    expect(isEnvironmentValuePlantedFromOverride("TZ")).toBe(false);
    expect(pageRow("TZ").source).toBe("environment");
  });
});

describe("a value assembled from what the deployment supplied", () => {
  const NAME = "TEST_PLANTED_ASSEMBLED_URL";

  beforeEach(() => {
    registerEnvironmentVariable({
      name: NAME,
      description: "assembled from deployment-supplied parts",
      secret: false,
      category: "core",
    });
  });

  afterEach(() => {
    setEnvironmentVariableOverrideSource(null);
    delete getRawProcessEnv()[NAME];
  });

  it("keeps reporting as a deployment value, and keeps outranking a stored one", () => {
    // The shape of the DATABASE_URL assembly: separate parts from the
    // deployment, combined and written back as one value.
    setEnvironmentVariable(NAME, "postgresql://host/db", "environment");
    installStore({ [NAME]: "postgresql://stored/db" });

    expect(isEnvironmentValuePlantedFromOverride(NAME)).toBe(false);
    expect(isEnvironmentVariableSetInProcess(NAME)).toBe(true);
    expect(getEnvironmentVariable(NAME)).toBe("postgresql://host/db");
    expect(getConfiguredEnvironmentValue(NAME)).toBe("postgresql://host/db");

    const row = pageRow(NAME);
    expect(row.source).toBe("environment");
    expect(shadowWarningShown(NAME, new Set([NAME]))).toBe(true);
  });
});
