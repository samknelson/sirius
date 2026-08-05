import crypto from "crypto";

/**
 * Freshly generated random credential material (hex-encoded) — never
 * hard-coded. Kept in its own module so secret scanners can see there is no
 * literal secret flowing into hashing code.
 */
export function generateRandomToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString("hex");
}
