import { EligibilityPlugin } from "../base";
import {
  EligibilityContext,
  EligibilityResult,
  EligibilityPluginMetadata,
  BaseEligibilityConfig,
} from "../types";
import { registerEligibilityPlugin } from "../registry";

interface AgeoutConfig extends BaseEligibilityConfig {
  minAge?: number | null;
  maxAge?: number | null;
}

function computeAgeInYears(birthDate: string, asOf: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  let age = asOf.getFullYear() - year;
  const beforeBirthday =
    asOf.getMonth() + 1 < month ||
    (asOf.getMonth() + 1 === month && asOf.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

class AgeoutPlugin extends EligibilityPlugin<AgeoutConfig> {
  readonly metadata: EligibilityPluginMetadata = {
    id: "ageout",
    name: "Ageout",
    description:
      "Worker must be within an inclusive age range (in whole years, computed from date of birth as of today) to be eligible. Either bound can be left blank to mean 'no limit on that side'.",
    configSchema: {
      type: "object",
      properties: {
        minAge: {
          type: ["integer", "null"],
          title: "Minimum age (years)",
          description:
            "Workers younger than this (in whole years) are ineligible. Inclusive. Leave blank for no minimum.",
          minimum: 0,
          default: null,
        },
        maxAge: {
          type: ["integer", "null"],
          title: "Maximum age (years)",
          description:
            "Workers older than this (in whole years) are ineligible. Inclusive. Leave blank for no maximum.",
          minimum: 0,
          default: null,
        },
      },
      allOf: [
        {
          if: {
            properties: {
              minAge: { type: "integer" },
              maxAge: { type: "integer" },
            },
            required: ["minAge", "maxAge"],
          },
          then: {
            properties: {
              minAge: {
                maximum: { $data: "1/maxAge" },
              },
            },
          },
        },
      ],
    },
  };

  async evaluate(
    context: EligibilityContext,
    config: AgeoutConfig
  ): Promise<EligibilityResult> {
    const minAge = config.minAge ?? null;
    const maxAge = config.maxAge ?? null;

    if (minAge !== null && maxAge !== null && minAge > maxAge) {
      return {
        eligible: false,
        reason: `Invalid ageout config: minAge (${minAge}) is greater than maxAge (${maxAge})`,
      };
    }

    if (minAge === null && maxAge === null) {
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

    const age = computeAgeInYears(contact.birthDate, new Date());
    if (age === null) {
      return {
        eligible: false,
        reason: `Worker has an unparseable date of birth: ${contact.birthDate}`,
      };
    }

    if (minAge !== null && age < minAge) {
      return {
        eligible: false,
        reason: `Worker is ${age} years old, below minimum age of ${minAge}`,
      };
    }

    if (maxAge !== null && age > maxAge) {
      return {
        eligible: false,
        reason: `Worker is ${age} years old, above maximum age of ${maxAge}`,
      };
    }

    const rangeLabel =
      minAge !== null && maxAge !== null
        ? `within range [${minAge}, ${maxAge}]`
        : minAge !== null
        ? `at or above minimum age of ${minAge}`
        : `at or below maximum age of ${maxAge}`;

    return {
      eligible: true,
      reason: `Worker is ${age} years old, ${rangeLabel}`,
    };
  }
}

const plugin = new AgeoutPlugin();
registerEligibilityPlugin(plugin);

export { AgeoutPlugin };
