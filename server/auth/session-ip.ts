import { isIP } from "node:net";

/**
 * One spelling per address, including IPv4-mapped IPv6. Invalid/missing
 * observations mean "not observed", not "clear the previously known IP".
 */
export function normalizeSessionIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6 || ip.includes("%")) return null;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16);
    const low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}
