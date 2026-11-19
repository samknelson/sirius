import { getEnvironmentVariable, registerEnvironmentVariable } from "../../../config/env-registry";

/**
 * TEMPORARY, site-wide. Conflicting coverage is not allowed in production;
 * while existing dual coverage is cleaned up, a feed leaves every conflicting
 * candidate out and reports it instead of stopping.
 *
 * To retire the rule: delete this registration, make
 * {@link conflictRuleInForce} return "refuse-conflicting", and remove the
 * exclusion branches it guards in coverage-conflicts.ts.
 */
export const EXCLUDE_CONFLICTS_VARIABLE = "EDI_EXCLUDE_CONFLICTING_COVERAGE";

registerEnvironmentVariable({
  name: EXCLUDE_CONFLICTS_VARIABLE,
  description:
    "Temporary rule for Trust Provider EDI files. On (default): coverage records that conflict for the same person, " +
    "benefit and month are left out of a generated file and listed for acknowledgement. Set to 'false' to stop a run " +
    "with a correction-required message instead; nothing is excluded.",
  secret: false,
  category: "trust.providers.edi",
  changeTakesEffect: "immediate",
  // On unless explicitly turned off, so an unset variable keeps feeds running.
  transform: value => /^(false|off|no|0)$/i.test((value ?? "").trim()) ? "false" : "true",
});

export type CoverageConflictRule = "exclude-conflicting" | "refuse-conflicting";

/** Read once per evidence check; each generated run records the answer. */
export function conflictRuleInForce(): CoverageConflictRule {
  return getEnvironmentVariable(EXCLUDE_CONFLICTS_VARIABLE) === "false"
    ? "refuse-conflicting" : "exclude-conflicting";
}
