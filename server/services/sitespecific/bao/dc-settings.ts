/**
 * Disability Credit fund settings.
 *
 * Staff-editable via the standard `variables` admin surface; this module is
 * the ONE place the raw variable values are parsed and defaulted, so every
 * consumer (eligibility service, upload wizard, future case screens) sees
 * identical semantics.
 *
 * Settings:
 * - `bao_dc_denial_letter_validity_months` — how long a denial letter keeps a
 *   worker eligible, measured from the letter date. Expiration is always
 *   DERIVED (letter date + this value); it is never persisted, so changing
 *   the setting is honored everywhere immediately. Default: 12.
 * - `bao_dc_retired_disability_row_mode` — what the BAO hours upload does
 *   with a row whose employment status is the RETIRED "Disability" status:
 *   `flag` surfaces the row for review (warning, data still recorded as
 *   reported), `reject` fails validation for that row. Default: `flag`, so a
 *   fund that has not decided yet never silently loses reported data.
 */
import { storage } from "../../../storage";

export const BAO_DC_DENIAL_LETTER_VALIDITY_VARIABLE =
  "bao_dc_denial_letter_validity_months";
export const BAO_DC_RETIRED_DISABILITY_ROW_MODE_VARIABLE =
  "bao_dc_retired_disability_row_mode";

export const BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT = 12;

export const BAO_DC_RETIRED_DISABILITY_ROW_MODES = ["flag", "reject"] as const;
export type BaoDcRetiredDisabilityRowMode =
  (typeof BAO_DC_RETIRED_DISABILITY_ROW_MODES)[number];
export const BAO_DC_RETIRED_DISABILITY_ROW_MODE_DEFAULT: BaoDcRetiredDisabilityRowMode =
  "flag";

/** Pure parser — exported for tests. Invalid/absent values fall back to the default. */
export function parseDenialLetterValidityMonths(raw: unknown): number {
  const value =
    typeof raw === "number" ? raw : parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > 120) {
    return BAO_DC_DENIAL_LETTER_VALIDITY_MONTHS_DEFAULT;
  }
  return value;
}

/** Pure parser — exported for tests. Invalid/absent values fall back to the default. */
export function parseRetiredDisabilityRowMode(raw: unknown): BaoDcRetiredDisabilityRowMode {
  const value = String(raw ?? "").trim().toLowerCase();
  return (BAO_DC_RETIRED_DISABILITY_ROW_MODES as readonly string[]).includes(value)
    ? (value as BaoDcRetiredDisabilityRowMode)
    : BAO_DC_RETIRED_DISABILITY_ROW_MODE_DEFAULT;
}

export async function getDcDenialLetterValidityMonths(): Promise<number> {
  const variable = await storage.variables.getByName(
    BAO_DC_DENIAL_LETTER_VALIDITY_VARIABLE,
  );
  return parseDenialLetterValidityMonths(variable?.value);
}

export async function getDcRetiredDisabilityRowMode(): Promise<BaoDcRetiredDisabilityRowMode> {
  const variable = await storage.variables.getByName(
    BAO_DC_RETIRED_DISABILITY_ROW_MODE_VARIABLE,
  );
  return parseRetiredDisabilityRowMode(variable?.value);
}
