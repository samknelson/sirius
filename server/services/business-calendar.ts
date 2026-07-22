import Holidays from "date-holidays";
import {
  businessCalendarDataSchema,
  type BusinessCalendarData,
  type BusinessCalendarSource,
} from "@shared/schema";
import type { BusinessCalendarWithRules } from "../storage/business-calendars";

const DEFAULT_WEEKENDS = [6, 7];
const MAX_SCAN_DAYS = 3660;

const HOLIDAY_TYPE_BY_SOURCE: Record<string, string> = {
  "date-holiday-public": "public",
  "date-holiday-bank": "bank",
  "date-holiday-observance": "observance",
  "date-holiday-school": "school",
  "date-holiday-optional": "optional",
};

function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [y, m, d] = ymd.split("-").map((v) => parseInt(v, 10));
  return { year: y, month: m, day: d };
}

function ymdToUtcDate(ymd: string): Date {
  const { year, month, day } = parseYmd(ymd);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateToYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(ymd: string, days: number): string {
  const date = ymdToUtcDate(ymd);
  date.setUTCDate(date.getUTCDate() + days);
  return utcDateToYmd(date);
}

/** ISO weekday: 1=Monday .. 7=Sunday */
function isoWeekday(ymd: string): number {
  const dow = ymdToUtcDate(ymd).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function buildHolidaysInstance(region: string | undefined): Holidays | undefined {
  if (!region) return undefined;
  const [country, state, sub] = region.split("-");
  const hd =
    sub !== undefined
      ? new Holidays(country, state!, sub)
      : state !== undefined
        ? new Holidays(country, state)
        : new Holidays(country);
  const countries = hd.getCountries();
  if (!countries || Object.keys(countries).length === 0) return undefined;
  return hd;
}

/**
 * Validate a date-holidays region string ("US", "US-la", "US-la-no").
 * Returns an error message, or undefined when valid (or absent).
 */
export function validateRegion(region: string | undefined | null): string | undefined {
  if (!region) return undefined;
  const parts = region.split("-");
  if (parts.length > 3) return `Region "${region}" has too many segments (max country-state-region)`;
  try {
    const hd = new Holidays();
    const countries = hd.getCountries() || {};
    const [country, state, sub] = parts;
    const countryKey = Object.keys(countries).find(
      (k) => k.toLowerCase() === country.toLowerCase(),
    );
    if (!countryKey) return `Unknown country "${country}" in region "${region}"`;
    if (state !== undefined) {
      const states = hd.getStates(countryKey) || {};
      const stateKey = Object.keys(states).find((k) => k.toLowerCase() === state.toLowerCase());
      if (!stateKey) return `Unknown state "${state}" for country "${countryKey}"`;
      if (sub !== undefined) {
        const regions = hd.getRegions(countryKey, stateKey) || {};
        const regionKey = Object.keys(regions).find((k) => k.toLowerCase() === sub.toLowerCase());
        if (!regionKey) return `Unknown region "${sub}" for "${countryKey}-${stateKey}"`;
      }
    }
    return undefined;
  } catch (err) {
    return `Region "${region}" is not recognized: ${err instanceof Error ? err.message : String(err)}`;
  }
}

interface HolidayEntry {
  ymd: string;
  type: string;
}

class CalendarComputer {
  private readonly sources: Set<string>;
  private readonly data: BusinessCalendarData;
  private readonly weekends: Set<number>;
  private readonly manualClosed: Set<string>;
  private readonly manualOpen: Set<string>;
  private readonly vacations: Array<{ start: string; end: string }>;
  private readonly holidayTypes: Set<string>;
  private hd: Holidays | undefined | null = null;
  private readonly holidayCache = new Map<number, HolidayEntry[]>();

  constructor(private readonly cal: BusinessCalendarWithRules) {
    this.sources = new Set(cal.calendar.sources as BusinessCalendarSource[]);
    const parsed = businessCalendarDataSchema.safeParse(cal.calendar.data ?? {});
    this.data = parsed.success ? parsed.data : {};
    this.weekends = new Set(this.data.weekends?.length ? this.data.weekends : DEFAULT_WEEKENDS);
    this.manualClosed = new Set(cal.manualByday.map((r) => r.ymd));
    this.manualOpen = new Set(cal.manualOpen.map((r) => r.ymd));
    this.vacations = cal.manualVacations.map((r) => ({ start: r.startYmd, end: r.endYmd }));
    this.holidayTypes = new Set(
      [...this.sources]
        .map((s) => HOLIDAY_TYPE_BY_SOURCE[s])
        .filter((t): t is string => Boolean(t)),
    );
  }

  private getHolidays(year: number): HolidayEntry[] {
    if (this.holidayTypes.size === 0) return [];
    if (this.hd === null) {
      this.hd = buildHolidaysInstance(this.data.region);
    }
    if (!this.hd) return [];
    const cached = this.holidayCache.get(year);
    if (cached) return cached;
    const raw = this.hd.getHolidays(year) || [];
    const entries: HolidayEntry[] = raw.map((h) => ({
      ymd: String(h.date).slice(0, 10),
      type: h.type,
    }));
    this.holidayCache.set(year, entries);
    return entries;
  }

  isBusinessDay(ymd: string): boolean {
    if (this.sources.has("manual-open") && this.manualOpen.has(ymd)) return true;

    if (this.sources.has("weekends") && this.weekends.has(isoWeekday(ymd))) return false;
    if (this.sources.has("manual-byday") && this.manualClosed.has(ymd)) return false;
    if (
      this.sources.has("manual-vacation") &&
      this.vacations.some((v) => v.start <= ymd && ymd <= v.end)
    ) {
      return false;
    }
    if (this.holidayTypes.size > 0) {
      const { year } = parseYmd(ymd);
      const holidays = this.getHolidays(year);
      if (holidays.some((h) => h.ymd === ymd && this.holidayTypes.has(h.type))) return false;
    }
    return true;
  }

  addBusinessDays(startYmd: string, n: number): string {
    if (n === 0) return startYmd;
    const step = n > 0 ? 1 : -1;
    let remaining = Math.abs(n);
    let current = startYmd;
    let scanned = 0;
    while (remaining > 0) {
      current = addDays(current, step);
      scanned += 1;
      if (scanned > MAX_SCAN_DAYS) {
        throw new Error(
          `addBusinessDays: scanned ${MAX_SCAN_DAYS} days from ${startYmd} without finding ${Math.abs(n)} business days — calendar may be closed every day`,
        );
      }
      if (this.isBusinessDay(current)) remaining -= 1;
    }
    return current;
  }
}

export function isBusinessDay(cal: BusinessCalendarWithRules, ymd: string): boolean {
  return new CalendarComputer(cal).isBusinessDay(ymd);
}

export function addBusinessDays(cal: BusinessCalendarWithRules, startYmd: string, n: number): string {
  return new CalendarComputer(cal).addBusinessDays(startYmd, n);
}
