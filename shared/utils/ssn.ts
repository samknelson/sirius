/**
 * SSN Utility Functions
 * Centralized SSN parsing, formatting, and validation
 */

export interface SSNValidationResult {
  valid: boolean;
  error?: string;
  parsed?: string;
}

/**
 * Parse SSN from various input formats to standardized 9-digit format
 * Strips non-digit characters and pads with leading zeros
 * 
 * Examples:
 * - "123-45-6789" -> "123456789"
 * - "123456789" -> "123456789"
 * - "8620006" -> "008620006"
 * - "1234567" -> "001234567"
 */
export function parseSSN(input: string): string {
  if (!input) {
    throw new Error('SSN is required');
  }

  // Strip all non-digit characters
  const digitsOnly = input.replace(/\D/g, '');

  if (digitsOnly.length === 0) {
    throw new Error('SSN must contain digits');
  }

  if (digitsOnly.length > 9) {
    throw new Error('SSN must be at most 9 digits');
  }

  // Pad with leading zeros to make 9 digits
  const padded = digitsOnly.padStart(9, '0');

  return padded;
}

/**
 * Format SSN for display
 * 
 * @param ssn - 9-digit SSN string
 * @param format - 'plain' for "123456789" or 'dashed' for "123-45-6789"
 */
export function formatSSN(ssn: string, format: 'plain' | 'dashed' = 'plain'): string {
  if (!ssn || ssn.length !== 9) {
    throw new Error('SSN must be exactly 9 digits for formatting');
  }

  if (!/^\d{9}$/.test(ssn)) {
    throw new Error('SSN must contain only digits');
  }

  if (format === 'dashed') {
    return `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5, 9)}`;
  }

  return ssn;
}

/**
 * Validate SSN according to SSA rules
 * - Must be exactly 9 digits (after parsing)
 * - Cannot be all zeros in any segment
 * - Cannot start with 9 (invalid area number)
 * - Cannot be 666 in the area number (reserved)
 * - Cannot be 000 in the area number
 */
export function validateSSN(input: string): SSNValidationResult {
  try {
    // Parse the input to standardized format
    const parsed = parseSSN(input);

    // Extract segments
    const areaNumber = parsed.slice(0, 3);
    const groupNumber = parsed.slice(3, 5);
    const serialNumber = parsed.slice(5, 9);

    // Validate area number
    if (areaNumber === '000') {
      return {
        valid: false,
        error: 'SSN area number cannot be 000'
      };
    }

    if (areaNumber === '666') {
      return {
        valid: false,
        error: 'SSN area number cannot be 666 (reserved)'
      };
    }

    if (areaNumber.startsWith('9')) {
      return {
        valid: false,
        error: 'SSN area number cannot start with 9'
      };
    }

    // Validate group number
    if (groupNumber === '00') {
      return {
        valid: false,
        error: 'SSN group number cannot be 00'
      };
    }

    // Validate serial number
    if (serialNumber === '0000') {
      return {
        valid: false,
        error: 'SSN serial number cannot be 0000'
      };
    }

    return {
      valid: true,
      parsed
    };
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Invalid SSN format'
    };
  }
}
