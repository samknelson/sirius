import { randomBytes } from "node:crypto";
import { getEnvironmentVariable } from "../config/env-registry";
import { captureAppliedRestartVariable } from "../services/env-restart-pending";

const KEY_NAME = "DEVICE_COOKIE_HMAC";
const ROW_NAME = `ENV_${KEY_NAME}`;

function validateKey(value: unknown): string {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") < 32 || !value.trim()) {
    throw new Error("DEVICE_COOKIE_HMAC must be a nonblank string of at least 32 UTF-8 bytes");
  }
  return value;
}

/**
 * One local initialization promise, not distributed coordination. Failure is
 * retryable; never sign with a key whose persistence or refresh did not finish.
 * Successful resolution is retained until process restart, including rotations.
 */
export function createDeviceCookieKeyResolver(): () => Promise<string> {
  let cached: string | undefined;
  let initializing: Promise<string> | undefined;

  async function initialize(): Promise<string> {
    const configured = getEnvironmentVariable(KEY_NAME);
    if (configured !== undefined) return validateKey(configured);

    const { storage } = await import("../storage");
    const { runVariableOnWrite } = await import("../modules/system/variable-registry");
    let row = await storage.variables.getByName(ROW_NAME);
    if (!row) {
      try {
        row = await storage.variables.create({
          name: ROW_NAME, value: randomBytes(32).toString("base64url"),
        });
      } catch (error) {
        if ((error as { code?: string })?.code !== "23505") throw error;
        row = await storage.variables.getByName(ROW_NAME);
        if (!row) throw error;
      }
    }
    // Invalid existing rows are configuration failures, not permission to replace.
    validateKey(row.value);
    await runVariableOnWrite(ROW_NAME);
    return validateKey(getEnvironmentVariable(KEY_NAME) ?? row.value);
  }

  return async () => {
    if (cached !== undefined) return cached;
    if (!initializing) {
      initializing = initialize().then(key => {
        // Lazy first use (including auto-generation) is already applied here,
        // not a setting waiting for restart. Later edits still diff this baseline.
        captureAppliedRestartVariable(KEY_NAME);
        cached = key;
        return key;
      }).finally(() => { initializing = undefined; });
    }
    return initializing;
  };
}

export const getDeviceCookieKey = createDeviceCookieKeyResolver();
