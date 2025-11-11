import crypto from 'crypto';

/**
 * Creates a deterministic hash of an array of strings (like header row)
 * @param values - Array of strings to hash
 * @returns SHA-256 hash as hex string
 */
export function hashHeaderRow(values: string[]): string {
  // Normalize values: trim, lowercase, sort to ensure consistency
  const normalized = values
    .map(v => (v || '').toString().trim().toLowerCase())
    .filter(v => v.length > 0)
    .sort();
  
  const combined = normalized.join('|');
  return crypto.createHash('sha256').update(combined).digest('hex');
}
