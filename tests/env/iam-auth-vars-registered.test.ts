/**
 * Every environment variable the IAM auth path reads must be REGISTERED.
 *
 * `getEnvironmentVariable()` throws on an unregistered name rather than
 * returning undefined — a deliberate design, but it means reading an undeclared
 * variable is a hard crash, not a missing value. That turns a one-line omission
 * into a container that never starts.
 *
 * This is a regression test for exactly that. `iamPasswordProvider` reads
 * AWS_REGION and AWS_DEFAULT_REGION, and both were missing from the registry.
 * The failure did not show up in typecheck, in unit tests, or in the image
 * build; it surfaced only when the migrate task ran in ECS, as:
 *
 *   Error: Environment variable "AWS_REGION" is not registered.
 *     at getEnvironmentVariable
 *     at iamPasswordProvider
 *
 * The names are asserted individually rather than by scanning db.ts, so that a
 * future reader sees WHICH variables the token signer depends on.
 */
import { describe, expect, it } from "vitest";
import {
  isEnvironmentVariableRegistered,
  getEnvironmentVariable,
} from "../../server/config/env-registry";

/** Read by server/storage/db.ts → iamPasswordProvider(). */
const IAM_AUTH_VARS = ["DB_IAM_AUTH", "DB_USER", "AWS_REGION", "AWS_DEFAULT_REGION"] as const;

/** Read by server/services/bringup.ts. */
const BRINGUP_VARS = ["BRINGUP_REPORT_ONLY"] as const;

describe("environment variables read on the IAM auth path", () => {
  it.each(IAM_AUTH_VARS)("%s is registered", (name) => {
    expect(isEnvironmentVariableRegistered(name)).toBe(true);
  });

  it.each(IAM_AUTH_VARS)("%s can be read without throwing", (name) => {
    // The value is irrelevant — undefined is a fine answer. What must not
    // happen is the registry rejecting the name, which is what crashed the
    // migrate task at boot.
    expect(() => getEnvironmentVariable(name)).not.toThrow();
  });
});

describe("environment variables read on the bring-up path", () => {
  it.each(BRINGUP_VARS)("%s is registered", (name) => {
    expect(isEnvironmentVariableRegistered(name)).toBe(true);
  });

  it.each(BRINGUP_VARS)("%s can be read without throwing", (name) => {
    expect(() => getEnvironmentVariable(name)).not.toThrow();
  });
});

describe("the registry's throw-on-unregistered contract still holds", () => {
  it("rejects a name nobody declared", () => {
    // Guards the guard: if this ever stopped throwing, the tests above would
    // pass vacuously and the next missing registration would ship again.
    expect(() => getEnvironmentVariable("DEFINITELY_NOT_A_REAL_FLS_VARIABLE")).toThrow(
      /not registered/,
    );
  });
});
