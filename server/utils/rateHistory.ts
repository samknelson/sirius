/**
 * Server-side rate history utilities
 * Matches the logic from client/src/lib/rateHistory.ts for consistency
 */

interface RateEntry {
  effectiveDate: string;
  rate: number;
}

/**
 * Sort rate history entries by effective date in descending order
 * Uses Date.parse for reliable date comparison across various formats
 */
export function sortRatesDescending<T extends { effectiveDate: string }>(
  rates: T[]
): T[] {
  return [...rates].sort((a, b) => {
    const dateA = new Date(a.effectiveDate).getTime();
    const dateB = new Date(b.effectiveDate).getTime();
    
    // Guard against invalid dates
    if (isNaN(dateA) && isNaN(dateB)) return 0;
    if (isNaN(dateA)) return 1; // Push invalid dates to end
    if (isNaN(dateB)) return -1;
    
    return dateB - dateA; // Descending order
  });
}

/**
 * Get the currently effective rate for a given reference date
 * Returns the rate entry where effectiveDate <= referenceDate
 * 
 * @param entries - Array of rate history entries
 * @param referenceDate - The date to check against
 * @returns The effective rate entry, or null if none found
 */
export function getCurrentEffectiveRate<T extends { effectiveDate: string }>(
  entries: T[],
  referenceDate: Date
): T | null {
  if (!entries || entries.length === 0) return null;
  
  // Normalize reference date to start of day
  const normalizedRef = new Date(referenceDate);
  normalizedRef.setHours(0, 0, 0, 0);
  
  // Sort rates by date descending
  const sortedRates = sortRatesDescending(entries);
  
  // Find the first entry where effectiveDate <= referenceDate
  const currentRate = sortedRates.find((entry) => {
    const entryDate = new Date(entry.effectiveDate);
    
    // Guard against invalid dates
    if (isNaN(entryDate.getTime())) return false;
    
    // Normalize to start of day for comparison
    entryDate.setHours(0, 0, 0, 0);
    
    return entryDate <= normalizedRef;
  });
  
  return currentRate ?? null;
}

/**
 * Get the current rate value from rate history
 * Convenience wrapper that extracts the rate number
 */
export function getCurrentRateValue(
  entries: Array<{ effectiveDate: string; rate: number }>,
  referenceDate: Date
): number | null {
  const entry = getCurrentEffectiveRate(entries, referenceDate);
  return entry?.rate ?? null;
}
