import { storage } from "../../server/storage";
import { isBusinessDay, addBusinessDays, validateRegion } from "../../server/services/business-calendar";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
}

async function main() {
  const cal = await storage.businessCalendars.create({
    name: "Verify calendar",
    sources: [
      "weekends",
      "manual-byday",
      "manual-vacation",
      "manual-open",
      "date-holiday-public",
    ],
    data: { region: "US", weekends: [6, 7] },
  });
  const id = cal.id;

  // 2026-07-03 (Fri) is US observed Independence Day; 2026-07-04 is Saturday.
  await storage.businessCalendars.createManualByday({ calendarId: id, ymd: "2026-07-08" });
  await storage.businessCalendars.createManualVacation({
    calendarId: id,
    startYmd: "2026-07-13",
    endYmd: "2026-07-17",
  });
  // Force-open a holiday: Christmas 2026-12-25 (Friday)
  await storage.businessCalendars.createManualOpen({ calendarId: id, ymd: "2026-12-25" });

  const full = (await storage.businessCalendars.getCalendarWithRules(id))!;

  check("weekend Sat closed", isBusinessDay(full, "2026-07-11"), false);
  check("weekend Sun closed", isBusinessDay(full, "2026-07-12"), false);
  check("normal weekday open", isBusinessDay(full, "2026-07-09"), true);
  check("US public holiday closed (Jul 4 observed Fri Jul 3)", isBusinessDay(full, "2026-07-03"), false);
  check("manual byday closed", isBusinessDay(full, "2026-07-08"), false);
  check("vacation day closed", isBusinessDay(full, "2026-07-15"), false);
  check("vacation boundary end closed", isBusinessDay(full, "2026-07-17"), false);
  check("day after vacation (Sat) closed by weekend", isBusinessDay(full, "2026-07-18"), false);
  check("manual-open beats holiday (Christmas)", isBusinessDay(full, "2026-12-25"), true);

  check("n=0 returns start", addBusinessDays(full, "2026-07-09", 0), "2026-07-09");
  // From Thu 2026-07-09: +1 -> Fri 7-10; +2 skips Sat/Sun -> Mon? Mon 7-13 is vacation... vacation 13-17 closed, so +2 = Mon 7-20
  check("addBusinessDays +1", addBusinessDays(full, "2026-07-09", 1), "2026-07-10");
  check("addBusinessDays +2 skips weekend+vacation", addBusinessDays(full, "2026-07-09", 2), "2026-07-20");
  // Negative: from Mon 2026-07-20 back 1 business day -> Fri 7-10 (vacation week + weekend skipped)
  check("addBusinessDays -1 across vacation", addBusinessDays(full, "2026-07-20", -1), "2026-07-10");
  // Around July 4th: from Thu 2026-07-02 +1 -> Mon 7-06 (Fri 3rd holiday, weekend)
  check("addBusinessDays +1 over holiday weekend", addBusinessDays(full, "2026-07-02", 1), "2026-07-06");
  // manual-open Christmas counts as business day: from Thu 2026-12-24 +1 -> Fri 12-25
  check("addBusinessDays +1 lands on forced-open Christmas", addBusinessDays(full, "2026-12-24", 1), "2026-12-25");

  check("validateRegion US ok", validateRegion("US"), undefined);
  check("validateRegion US-la ok", validateRegion("US-la"), undefined);
  check("validateRegion bogus rejected", typeof validateRegion("XX"), "string");

  // Source gating: disable manual-byday & vacation — rows become inert
  await storage.businessCalendars.update(id, { sources: ["weekends"] });
  const gated = (await storage.businessCalendars.getCalendarWithRules(id))!;
  check("byday inert when source off", isBusinessDay(gated, "2026-07-08"), true);
  check("vacation inert when source off", isBusinessDay(gated, "2026-07-15"), true);
  check("holiday inert when source off", isBusinessDay(gated, "2026-07-03"), true);
  check("manual-open irrelevant but weekend still closed", isBusinessDay(gated, "2026-07-11"), false);

  // All-closed safety cap
  await storage.businessCalendars.update(id, {
    sources: ["weekends"],
    data: { weekends: [1, 2, 3, 4, 5, 6, 7] },
  });
  const closed = (await storage.businessCalendars.getCalendarWithRules(id))!;
  try {
    addBusinessDays(closed, "2026-01-01", 1);
    check("all-closed calendar throws", "no-throw", "throw");
  } catch {
    check("all-closed calendar throws", "throw", "throw");
  }

  await storage.businessCalendars.delete(id);
  const gone = await storage.businessCalendars.get(id);
  check("delete cascades", gone === undefined, true);

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
