import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";

interface AgeoutConfig extends BaseEligibilityConfig {
  // Fractional-year shape (years + months 0..11). Each pair is
  // independent: a bound is "set" iff its `*Years` field is an integer.
  minYears?: number | null;
  minMonths?: number | null;
  maxYears?: number | null;
  maxMonths?: number | null;
  // Inner warning band. A worker whose age falls outside [warnMin, warnMax]
  // but still inside [min, max] is eligible-with-warning.
  warnMinYears?: number | null;
  warnMinMonths?: number | null;
  warnMaxYears?: number | null;
  warnMaxMonths?: number | null;
}

function computeAgeInMonths(
  birthDate: string,
  asOfYear: number,
  asOfMonth: number,
): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return null;
  }
  // Day-of-month is intentionally ignored: the eligibility scan window
  // is month-grained (asOfYear/asOfMonth only — no day component), so
  // a worker is "age N months" during asOfMonth iff
  // (asOfYear - birthYear) * 12 + (asOfMonth - birthMonth) >= N.
  return (asOfYear - year) * 12 + (asOfMonth - month);
}

function toMonths(years: number | null, months: number | null): number | null {
  if (years === null || years === undefined) return null;
  return years * 12 + (months ?? 0);
}

function effectiveMinMonths(c: AgeoutConfig): number | null {
  return toMonths(c.minYears ?? null, c.minMonths ?? null);
}

function effectiveMaxMonths(c: AgeoutConfig): number | null {
  return toMonths(c.maxYears ?? null, c.maxMonths ?? null);
}

function formatYM(totalMonths: number): string {
  const y = Math.floor(totalMonths / 12);
  const m = totalMonths - y * 12;
  const yLabel = `${y} ${y === 1 ? "year" : "years"}`;
  if (m === 0) return yLabel;
  const mLabel = `${m} ${m === 1 ? "month" : "months"}`;
  return `${yLabel} ${mLabel}`;
}

function makeYearsField(title: string, description: string): Record<string, unknown> {
  return {
    type: ["integer", "null"],
    title,
    description,
    minimum: 0,
    default: null,
  };
}

function makeMonthsField(title: string): Record<string, unknown> {
  return {
    type: ["integer", "null"],
    title,
    description: "Months portion (0–11). Defaults to 0 when the years field is set.",
    minimum: 0,
    maximum: 11,
    default: null,
  };
}

class AgeoutPlugin extends EligibilityPlugin<AgeoutConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "ageout",
    name: "Ageout",
    description:
      "Worker must be within an inclusive age range (years + months precision) to be eligible. Optional inner warning band marks workers as eligible-with-warning when they're inside the range but near a configured edge. Any bound left blank means 'no limit on that side'.",
    configSchema: {
      type: "object",
      properties: {
        minYears: makeYearsField(
          "Minimum age — years",
          "Workers younger than this are ineligible. Inclusive. Leave blank for no minimum.",
        ),
        minMonths: makeMonthsField("Minimum age — months"),
        maxYears: makeYearsField(
          "Maximum age — years",
          "Workers older than this are ineligible. Inclusive. Leave blank for no maximum.",
        ),
        maxMonths: makeMonthsField("Maximum age — months"),
        warnMinYears: makeYearsField(
          "Warning band — minimum years",
          "Workers between [min, warnMin) are eligible but flagged with a warning. Leave blank for no lower warning.",
        ),
        warnMinMonths: makeMonthsField("Warning band — minimum months"),
        warnMaxYears: makeYearsField(
          "Warning band — maximum years",
          "Workers between (warnMax, max] are eligible but flagged with a warning. Leave blank for no upper warning.",
        ),
        warnMaxMonths: makeMonthsField("Warning band — maximum months"),
      },
      // Year-level cross-bound checks (inexpensive AJV $data refs).
      // Precise month-level cross-bound validation lives in
      // `validateConfig` below so the server rejects mismatched pairs
      // even when year-level ordering happens to pass.
      allOf: [
        {
          if: {
            properties: {
              minYears: { type: "integer" },
              maxYears: { type: "integer" },
            },
            required: ["minYears", "maxYears"],
          },
          then: {
            properties: {
              minYears: { maximum: { $data: "1/maxYears" } },
            },
          },
        },
        {
          if: {
            properties: {
              warnMinYears: { type: "integer" },
              warnMaxYears: { type: "integer" },
            },
            required: ["warnMinYears", "warnMaxYears"],
          },
          then: {
            properties: {
              warnMinYears: { maximum: { $data: "1/warnMaxYears" } },
            },
          },
        },
        {
          if: {
            properties: {
              minYears: { type: "integer" },
              warnMinYears: { type: "integer" },
            },
            required: ["minYears", "warnMinYears"],
          },
          then: {
            properties: {
              warnMinYears: { minimum: { $data: "1/minYears" } },
            },
          },
        },
        {
          if: {
            properties: {
              maxYears: { type: "integer" },
              warnMaxYears: { type: "integer" },
            },
            required: ["maxYears", "warnMaxYears"],
          },
          then: {
            properties: {
              warnMaxYears: { maximum: { $data: "1/maxYears" } },
            },
          },
        },
      ],
    },
  };

  async validateConfig(config: unknown): Promise<{ valid: boolean; errors?: string[] }> {
    const base = await super.validateConfig(config);
    if (!base.valid) return base;
    const c = (config ?? {}) as AgeoutConfig;
    const errors: string[] = [];
    const min = effectiveMinMonths(c);
    const max = effectiveMaxMonths(c);
    const wMin = toMonths(c.warnMinYears ?? null, c.warnMinMonths ?? null);
    const wMax = toMonths(c.warnMaxYears ?? null, c.warnMaxMonths ?? null);
    if (min !== null && max !== null && min > max) {
      errors.push(
        `Minimum age (${formatYM(min)}) must be less than or equal to maximum age (${formatYM(max)}).`,
      );
    }
    if (wMin !== null && wMax !== null && wMin > wMax) {
      errors.push(
        `Warning minimum (${formatYM(wMin)}) must be less than or equal to warning maximum (${formatYM(wMax)}).`,
      );
    }
    if (wMin !== null && min !== null && wMin < min) {
      errors.push(
        `Warning minimum (${formatYM(wMin)}) must be at or above the eligible minimum (${formatYM(min)}).`,
      );
    }
    if (wMin !== null && max !== null && wMin > max) {
      errors.push(
        `Warning minimum (${formatYM(wMin)}) must be at or below the eligible maximum (${formatYM(max)}).`,
      );
    }
    if (wMax !== null && max !== null && wMax > max) {
      errors.push(
        `Warning maximum (${formatYM(wMax)}) must be at or below the eligible maximum (${formatYM(max)}).`,
      );
    }
    if (wMax !== null && min !== null && wMax < min) {
      errors.push(
        `Warning maximum (${formatYM(wMax)}) must be at or above the eligible minimum (${formatYM(min)}).`,
      );
    }
    if (errors.length > 0) return { valid: false, errors };
    return { valid: true };
  }

  async evaluate(
    context: EligibilityContext,
    config: AgeoutConfig,
  ): Promise<EligibilityResult> {
    const min = effectiveMinMonths(config);
    const max = effectiveMaxMonths(config);
    const wMin = toMonths(config.warnMinYears ?? null, config.warnMinMonths ?? null);
    const wMax = toMonths(config.warnMaxYears ?? null, config.warnMaxMonths ?? null);

    // Defense-in-depth: re-check every cross-bound constraint at
    // evaluate time so a persisted-but-invalid config (e.g. one that
    // bypassed save-time validation) fails closed instead of silently
    // producing misleading pass/warning verdicts.
    if (min !== null && max !== null && min > max) {
      return {
        eligible: false,
        reason: `Invalid ageout config: minimum age (${formatYM(min)}) is greater than maximum age (${formatYM(max)})`,
      };
    }
    if (wMin !== null && wMax !== null && wMin > wMax) {
      return {
        eligible: false,
        reason: `Invalid ageout config: warning minimum (${formatYM(wMin)}) is greater than warning maximum (${formatYM(wMax)})`,
      };
    }
    if (wMin !== null && min !== null && wMin < min) {
      return {
        eligible: false,
        reason: `Invalid ageout config: warning minimum (${formatYM(wMin)}) is below the eligible minimum (${formatYM(min)})`,
      };
    }
    if (wMin !== null && max !== null && wMin > max) {
      return {
        eligible: false,
        reason: `Invalid ageout config: warning minimum (${formatYM(wMin)}) is above the eligible maximum (${formatYM(max)})`,
      };
    }
    if (wMax !== null && max !== null && wMax > max) {
      return {
        eligible: false,
        reason: `Invalid ageout config: warning maximum (${formatYM(wMax)}) is above the eligible maximum (${formatYM(max)})`,
      };
    }
    if (wMax !== null && min !== null && wMax < min) {
      return {
        eligible: false,
        reason: `Invalid ageout config: warning maximum (${formatYM(wMax)}) is below the eligible minimum (${formatYM(min)})`,
      };
    }

    if (min === null && max === null) {
      return {
        eligible: true,
        reason: "Ageout has no minimum or maximum configured (no age restriction)",
      };
    }

    const contact = await context.getContact();
    if (!contact || !contact.birthDate) {
      return {
        eligible: false,
        reason: "Worker has no date of birth on file",
      };
    }

    // Use the rule's asOf month/year (day-of-month not tracked) so
    // ageout is reproducible for back-dated evaluation.
    const ageMonths = computeAgeInMonths(
      contact.birthDate,
      context.asOfYear,
      context.asOfMonth,
    );
    if (ageMonths === null) {
      return {
        eligible: false,
        reason: `Worker has an unparseable date of birth: ${contact.birthDate}`,
      };
    }

    const ageLabel = formatYM(Math.max(0, ageMonths));

    if (min !== null && ageMonths < min) {
      return {
        eligible: false,
        reason: `Worker is ${ageLabel} old, below minimum age of ${formatYM(min)}`,
      };
    }

    if (max !== null && ageMonths > max) {
      return {
        eligible: false,
        reason: `Worker is ${ageLabel} old, above maximum age of ${formatYM(max)}`,
      };
    }

    const rangeLabel =
      min !== null && max !== null
        ? `within range [${formatYM(min)}, ${formatYM(max)}]`
        : min !== null
        ? `at or above minimum age of ${formatYM(min)}`
        : `at or below maximum age of ${formatYM(max!)}`;

    let warning: string | undefined;
    if (wMin !== null && ageMonths < wMin && min !== null) {
      warning = `Worker is ${ageLabel} old; approaching minimum age of ${formatYM(min)}`;
    } else if (wMin !== null && ageMonths < wMin) {
      warning = `Worker is ${ageLabel} old; below the warning minimum of ${formatYM(wMin)}`;
    } else if (wMax !== null && ageMonths > wMax && max !== null) {
      warning = `Worker is ${ageLabel} old; approaching maximum age of ${formatYM(max)}`;
    } else if (wMax !== null && ageMonths > wMax) {
      warning = `Worker is ${ageLabel} old; above the warning maximum of ${formatYM(wMax)}`;
    }

    return {
      eligible: true,
      reason: `Worker is ${ageLabel} old, ${rangeLabel}`,
      warning,
    };
  }
}

const plugin = new AgeoutPlugin();
registerEligibilityPlugin(plugin);

export { AgeoutPlugin };
