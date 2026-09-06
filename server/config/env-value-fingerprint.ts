/**
 * One digest of an environment variable's effective value.
 *
 * Two callers need to answer "is this the same value?" without holding the
 * value: the restart-pending baseline (same value as at boot?) and the
 * Environment page (does another installation hold the same secret?). Both go
 * through here so the digest of a given value is defined in exactly one place
 * and the two answers cannot drift apart.
 *
 * The digest is deliberately UNSALTED. A salted or per-installation digest
 * would differ between two systems holding the same value, which is precisely
 * the comparison the Environment page exists to make. The consequence is that
 * anyone who can read a fingerprint can confirm a guessed value offline, so a
 * fingerprint is only ever shown behind the same gate as the power to change
 * the variable — never on a non-admin surface, never in a log line, never in
 * an error message. Truncating it does not soften that; the short form is for
 * readability only.
 */
import { createHash } from "node:crypto";
import { getConfiguredEnvironmentValue } from "./env-registry";

/** Sentinel distinguishing "unset" from a value that happens to be empty. */
export const ENV_VALUE_UNSET = "\u0000unset";

/**
 * Hex characters of the digest shown to a human. Long enough that two
 * different secrets will not collide in practice, short enough to compare two
 * screens by eye.
 */
export const ENV_FINGERPRINT_LENGTH = 12;

/**
 * Full digest of a variable's CONFIGURED value — transforms and overrides
 * included — or {@link ENV_VALUE_UNSET} when it has none.
 *
 * Configured, rather than the value the process is running on, because both
 * callers are asking about configuration: whether two installations are set up
 * the same, and whether someone has changed a setting since this process
 * started. The two answers differ for a value the app planted in its own
 * environment from a stored one — reading the planted value back would report
 * a changed or cleared setting as unchanged, which is exactly the
 * waiting-on-a-restart case an operator has to be told about.
 */
export function fingerprintEnvironmentValue(name: string): string {
  let value: string | undefined;
  try {
    value = getConfiguredEnvironmentValue(name);
  } catch {
    // An unregistered name throws. Treat it the same as unset: every caller
    // here only cares whether the value changed.
    value = undefined;
  }
  if (value === undefined || value === "") return ENV_VALUE_UNSET;
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The displayable form: a short prefix of the digest, or null when the
 * variable has no value to fingerprint.
 */
export function shortEnvironmentValueFingerprint(name: string): string | null {
  const full = fingerprintEnvironmentValue(name);
  if (full === ENV_VALUE_UNSET) return null;
  return full.slice(0, ENV_FINGERPRINT_LENGTH);
}
