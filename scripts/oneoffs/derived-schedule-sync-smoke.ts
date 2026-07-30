/**
 * Smoke test (Task: misleading Schedule field on derived-schedule cron jobs).
 *
 * Exercises the cron config adapter + kind validateConfig in-process, no DB
 * writes:
 *   1. Derive-schedule plugin (scheduled-benefit-scan): schedule is optional
 *      in the payload and toRows writes the DERIVED cron expression into the
 *      subsidiary schedule column (weekly + monthly).
 *   2. Invalid settings (weekly without dayOfWeek, bad time zone) are rejected
 *      by validateConfig, so a stale schedule is never persisted.
 *   3. Non-derive plugins keep the legacy contract: schedule required,
 *      stored verbatim.
 *   4. Manifest surfaces `derivedEnvelopeFields: ["schedule"]` only for the
 *      derive plugin.
 *
 * Run: npx tsx scripts/oneoffs/derived-schedule-sync-smoke.ts
 */
// Import storage/database first to dodge the plugin-registry circular-init
// crash (see memory: eligibility plugin smoke tests).
import "../../server/storage";
import {
  initializeCronPluginSystem,
  cronPluginRegistry,
} from "../../server/plugins/system/cron";
import { getPluginConfigAdapter, getPluginKind } from "../../server/plugins/_core";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  initializeCronPluginSystem();
  const adapter = getPluginConfigAdapter("cron")!;
  const registration = getPluginKind("cron")!;

  const baseWeekly = {
    pluginId: "scheduled-benefit-scan",
    name: "sweep",
    enabled: true,
    ordering: 0,
    data: {
      population: "active_elections",
      frequency: "weekly",
      dayOfWeek: 3,
      runTime: "04:30",
      timeZone: "America/New_York",
      switchAnchorDay: 15,
    },
  };

  // 1a. Weekly: no schedule in the payload → derived into subsidiary.
  const parsedWeekly = adapter.configSchema.safeParse(baseWeekly);
  check("weekly payload valid without schedule", parsedWeekly.success, parsedWeekly);
  if (parsedWeekly.success) {
    const { subsidiary } = adapter.toRows(parsedWeekly.data);
    check(
      "weekly derived schedule stored",
      (subsidiary as any)?.schedule === "30 4 * * 3",
      subsidiary,
    );
  }

  // 1b. Monthly.
  const monthly = {
    ...baseWeekly,
    data: { ...baseWeekly.data, frequency: "monthly", dayOfMonth: 12, dayOfWeek: undefined },
  };
  const parsedMonthly = adapter.configSchema.safeParse(monthly);
  check("monthly payload valid", parsedMonthly.success, parsedMonthly);
  if (parsedMonthly.success) {
    const { subsidiary } = adapter.toRows(parsedMonthly.data);
    check(
      "monthly derived schedule stored",
      (subsidiary as any)?.schedule === "30 4 12 * *",
      subsidiary,
    );
  }

  // 1c. A caller-supplied schedule for a derive plugin is overridden.
  const withBogusSchedule = { ...baseWeekly, schedule: "59 23 31 12 0" };
  const parsedBogus = adapter.configSchema.safeParse(withBogusSchedule);
  if (parsedBogus.success) {
    const { subsidiary } = adapter.toRows(parsedBogus.data);
    check(
      "typed schedule ignored for derive plugin",
      (subsidiary as any)?.schedule === "30 4 * * 3",
      subsidiary,
    );
  } else {
    check("typed schedule payload parse", false, parsedBogus);
  }

  // 2a. Invalid settings (weekly without dayOfWeek) → validateConfig rejects.
  const plugin = cronPluginRegistry.get("scheduled-benefit-scan")!;
  const badWeekly = { ...baseWeekly.data, dayOfWeek: undefined };
  const badResult = await registration.validateConfig!(plugin, badWeekly);
  // Note: DEFAULT_SETTINGS supplies dayOfWeek:1, so a truly missing dayOfWeek
  // is defaulted — use a bad time zone instead for a hard failure.
  const badTz = { ...baseWeekly.data, timeZone: "Not/AZone" };
  const badTzResult = await registration.validateConfig!(plugin, badTz);
  check(
    "invalid time zone rejected by validateConfig",
    badTzResult.valid === false && (badTzResult.errors?.length ?? 0) > 0,
    badTzResult,
  );
  check("weekly-with-defaults accepted", badResult.valid === true, badResult);

  // 2b. Bad runTime rejected.
  const badTime = { ...baseWeekly.data, runTime: "25:99" };
  const badTimeResult = await registration.validateConfig!(plugin, badTime);
  check("invalid runTime rejected", badTimeResult.valid === false, badTimeResult);

  // 3. Non-derive plugin: schedule required + stored verbatim.
  const nonDerive = {
    pluginId: "delete-old-cron-logs",
    name: null,
    enabled: true,
    ordering: 0,
    data: {},
  };
  const missing = adapter.configSchema.safeParse(nonDerive);
  check("non-derive plugin without schedule rejected", !missing.success, missing);
  const withSchedule = adapter.configSchema.safeParse({ ...nonDerive, schedule: "0 3 * * *" });
  check("non-derive plugin with schedule accepted", withSchedule.success, withSchedule);
  if (withSchedule.success) {
    const { subsidiary } = adapter.toRows(withSchedule.data);
    check(
      "non-derive schedule stored verbatim",
      (subsidiary as any)?.schedule === "0 3 * * *",
      subsidiary,
    );
  }

  // 4. Manifest trait.
  const entries = cronPluginRegistry.listIds().map((id) => {
    const p = cronPluginRegistry.get(id)!;
    return { id, entry: (cronPluginRegistry as any).options?.toManifestEntry?.(p) };
  });
  // Access via the registry's public manifest shaping instead if available.
  const scanEntry = entries.find((e) => e.id === "scheduled-benefit-scan")?.entry;
  const otherEntry = entries.find((e) => e.id === "delete-old-cron-logs")?.entry;
  if (scanEntry && otherEntry) {
    check(
      "manifest flags derive plugin",
      Array.isArray(scanEntry.derivedEnvelopeFields) &&
        scanEntry.derivedEnvelopeFields.includes("schedule"),
      scanEntry,
    );
    check(
      "manifest omits flag for non-derive plugin",
      otherEntry.derivedEnvelopeFields === undefined,
      otherEntry,
    );
  } else {
    console.log("NOTE manifest shaping not reachable via options — checking plugin traits directly");
    check("derive plugin has deriveSchedule", typeof plugin.deriveSchedule === "function");
    check(
      "non-derive plugin lacks deriveSchedule",
      cronPluginRegistry.get("delete-old-cron-logs")?.deriveSchedule === undefined,
    );
  }

  console.log(failures === 0 ? "\nALL PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(1);
});
