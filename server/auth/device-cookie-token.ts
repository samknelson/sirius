import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const DEVICE_COOKIE_NAME = "device_id";
export const DEVICE_COOKIE_LIFETIME_SECONDS = 400 * 24 * 60 * 60;
export const DEVICE_COOKIE_RENEW_SECONDS = 10 * 24 * 60 * 60;
const FUTURE_TOLERANCE_SECONDS = 5 * 60;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function signature(uuid: string, timestamp: string, key: string): Buffer {
  return createHmac("sha256", key).update(`device_id:v1:${uuid}.${timestamp}`).digest();
}

export function signDeviceCookie(uuid: string, timestamp: number, key: string): string {
  const stamp = String(timestamp);
  return `${uuid}.${stamp}.${signature(uuid, stamp, key).toString("base64url")}`;
}

/** Strict canonical input before decoding or comparing the fixed-size MAC. */
export function verifyDeviceCookie(value: string | undefined, key: string, now: number): {
  uuid: string; timestamp: number;
} | undefined {
  if (!value || value.length > 97) return undefined;
  const parts = value.split(".");
  if (parts.length !== 3) return undefined;
  const [uuid, stamp, mac] = parts;
  if (!UUID_V4.test(uuid) || !/^(0|[1-9][0-9]{0,15})$/.test(stamp) ||
      !/^[A-Za-z0-9_-]{43}$/.test(mac)) return undefined;
  const timestamp = Number(stamp);
  if (!Number.isSafeInteger(timestamp) || timestamp > now + FUTURE_TOLERANCE_SECONDS ||
      now - timestamp > DEVICE_COOKIE_LIFETIME_SECONDS) return undefined;
  const supplied = Buffer.from(mac, "base64url");
  if (supplied.length !== 32 || supplied.toString("base64url") !== mac ||
      !timingSafeEqual(supplied, signature(uuid, stamp, key))) return undefined;
  return { uuid, timestamp };
}

/** Unlike a cookie map, this rejects duplicate names rather than choosing one. */
export function readDeviceCookie(header: string | undefined): string | undefined {
  const matches = (header ?? "").split(";").map(part => part.trim())
    .filter(part => part.split("=", 1)[0].trim() === DEVICE_COOKIE_NAME);
  if (matches.length !== 1) return undefined;
  const part = matches[0];
  const equals = part.indexOf("=");
  return equals === -1 ? undefined : part.slice(equals + 1);
}

export function resolveDeviceCookie(value: string | undefined, key: string, now: number): {
  uuid: string; cookie?: string;
} {
  const verified = verifyDeviceCookie(value, key, now);
  const uuid = verified?.uuid ?? randomUUID();
  if (verified && now - verified.timestamp <= DEVICE_COOKIE_RENEW_SECONDS) return { uuid };
  return { uuid, cookie: signDeviceCookie(uuid, now, key) };
}
