/**
 * `isIamAuth()` must answer from the ENVIRONMENT, not from a side effect.
 *
 * It used to return a module-level flag that only `assembleDatabaseUrl()` set.
 * That made the answer depend on whether an entry point had run: only
 * `production-entry.ts` calls it, so anything importing
 * `server/storage/db` directly — `scripts/db-push.ts` does — saw `false` no
 * matter what `DB_IAM_AUTH` said. Combined with a password-less URL that
 * selects the password path and connects with an EMPTY password, which is
 * precisely the failure that took a long time to diagnose once already (the RDS
 * Proxy reports it only as "the authentication token is empty").
 *
 * These tests pin the property that removes the ordering dependency: the answer
 * is a pure function of the environment, correct before `assembleDatabaseUrl()`
 * has ever been called.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isIamAuth } from "../../server/config/assemble-database-url";

const ORIGINAL = process.env.DB_IAM_AUTH;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.DB_IAM_AUTH;
  else process.env.DB_IAM_AUTH = ORIGINAL;
});

describe("isIamAuth() reads the environment directly", () => {
  it("is false when DB_IAM_AUTH is unset", () => {
    delete process.env.DB_IAM_AUTH;
    expect(isIamAuth()).toBe(false);
  });

  it.each(["1", "true", "TRUE", "yes", "on", " on "])(
    "is true for %o without assembleDatabaseUrl() having run",
    (v) => {
      process.env.DB_IAM_AUTH = v;
      // The critical assertion: no call to assembleDatabaseUrl() anywhere in
      // this test. Under the old side-effect flag every one of these returned
      // false.
      expect(isIamAuth()).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", ""])("is false for %o", (v) => {
    process.env.DB_IAM_AUTH = v;
    expect(isIamAuth()).toBe(false);
  });

  it("tracks changes between calls rather than latching", () => {
    process.env.DB_IAM_AUTH = "1";
    expect(isIamAuth()).toBe(true);
    delete process.env.DB_IAM_AUTH;
    expect(isIamAuth()).toBe(false);
  });
});
