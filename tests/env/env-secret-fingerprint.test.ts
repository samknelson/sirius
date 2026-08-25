/**
 * The Environment page's secret fingerprints.
 *
 * A secret's value must never reach the client, but an administrator still has
 * to be able to tell whether two installations hold the same secret. The
 * listing therefore carries a short digest instead of the value. Both halves of
 * that bargain are silent failures if they break — a leaked value looks like a
 * normal row on screen, and a per-process digest looks like two systems that
 * merely disagree — so they are asserted here at the route level, against the
 * real registry and the real route handler.
 */
import express from "express";
import type { Express } from "express";
import { describe, expect, it, beforeAll, vi } from "vitest";

// The listing is admin-gated in production; the gate itself is not what these
// tests are about, so it is stubbed open.
vi.mock("../../server/services/access-policy-evaluator", () => ({
  requireAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { registerEnvRoutes } from "../../server/modules/system/env";
import {
  getRawProcessEnv,
  registerEnvironmentVariables,
} from "../../server/config/env-registry";
import {
  ENV_FINGERPRINT_LENGTH,
  fingerprintEnvironmentValue,
} from "../../server/config/env-value-fingerprint";

const SECRET_A = "TEST_ENV_FP_SECRET_A";
const SECRET_B = "TEST_ENV_FP_SECRET_B";
const SECRET_DIFFERENT = "TEST_ENV_FP_SECRET_DIFFERENT";
const SECRET_UNSET = "TEST_ENV_FP_SECRET_UNSET";
const PLAIN = "TEST_ENV_FP_PLAIN";

const SHARED_VALUE = "the-same-secret-on-both-systems";
const OTHER_VALUE = "a-different-secret";
const PLAIN_VALUE = "not-a-secret";

interface EnvRow {
  name: string;
  secret: boolean;
  isSet: boolean;
  value: string | null;
  valueFingerprint?: string;
}

let app: Express;

async function listing(): Promise<{ rows: EnvRow[]; body: string }> {
  const server = app.listen(0);
  try {
    const address = server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("expected a TCP address");
    }
    const res = await fetch(`http://127.0.0.1:${address.port}/api/admin/env`);
    expect(res.status, "listing should succeed").toBe(200);
    const body = await res.text();
    return { rows: JSON.parse(body) as EnvRow[], body };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function row(rows: EnvRow[], name: string): EnvRow {
  const found = rows.find((r) => r.name === name);
  expect(found, `listing missing ${name}`).toBeTruthy();
  return found!;
}

describe("secret fingerprints on the environment listing", () => {
  beforeAll(() => {
    registerEnvironmentVariables([
      { name: SECRET_A, description: "secret a", secret: true, category: "core" },
      { name: SECRET_B, description: "secret b", secret: true, category: "core" },
      {
        name: SECRET_DIFFERENT,
        description: "a different secret",
        secret: true,
        category: "core",
      },
      {
        name: SECRET_UNSET,
        description: "an unset secret",
        secret: true,
        category: "core",
      },
      { name: PLAIN, description: "not secret", secret: false, category: "core" },
    ]);

    const env = getRawProcessEnv();
    env[SECRET_A] = SHARED_VALUE;
    env[SECRET_B] = SHARED_VALUE;
    env[SECRET_DIFFERENT] = OTHER_VALUE;
    delete env[SECRET_UNSET];
    env[PLAIN] = PLAIN_VALUE;

    app = express();
    registerEnvRoutes(app);
  });

  it("a set secret carries a fingerprint and no value", async () => {
    const { rows } = await listing();
    const secret = row(rows, SECRET_A);
    expect(secret.isSet, "should read as set").toBe(true);
    expect(secret.value, "a secret's value must never be sent").toBeNull();
    expect(secret.valueFingerprint, "a set secret should carry a fingerprint")
      .toBeTruthy();
    expect(
      secret.valueFingerprint!.length,
      "fingerprint should be the short form",
    ).toBe(ENV_FINGERPRINT_LENGTH);
    expect(
      secret.valueFingerprint,
      "fingerprint should be the shared digest of the effective value",
    ).toBe(fingerprintEnvironmentValue(SECRET_A).slice(0, ENV_FINGERPRINT_LENGTH));
  });

  it("the secret value appears nowhere in the serialized response", async () => {
    const { body } = await listing();
    expect(body.includes(SHARED_VALUE), "listing leaked a secret value").toBe(false);
    expect(body.includes(OTHER_VALUE), "listing leaked a secret value").toBe(false);
  });

  it("equal values fingerprint the same, different values differ", async () => {
    const { rows } = await listing();
    // The point of the feature: an administrator comparing two screens.
    expect(
      row(rows, SECRET_A).valueFingerprint,
      "same value must fingerprint the same",
    ).toBe(row(rows, SECRET_B).valueFingerprint);
    expect(
      row(rows, SECRET_DIFFERENT).valueFingerprint,
      "a different value must fingerprint differently",
    ).not.toBe(row(rows, SECRET_A).valueFingerprint);
  });

  it("an unset secret has no fingerprint", async () => {
    const { rows } = await listing();
    const unset = row(rows, SECRET_UNSET);
    expect(unset.isSet, "should read as unset").toBe(false);
    expect(
      "valueFingerprint" in unset,
      "an unset secret has nothing to fingerprint",
    ).toBe(false);
  });

  it("a non-secret variable is unchanged", async () => {
    const { rows } = await listing();
    const plain = row(rows, PLAIN);
    expect(plain.value, "non-secret values are still shown in full").toBe(PLAIN_VALUE);
    expect(
      "valueFingerprint" in plain,
      "a visible value needs no fingerprint",
    ).toBe(false);
  });
});
