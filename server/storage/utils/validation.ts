export interface ValidationError {
  field: string;
  code: string;
  message: string;
}

export type ValidationResult<T> = 
  | { ok: true; value: T }
  | { ok: false; errors: ValidationError[] };

export class DomainValidationError extends Error {
  public readonly errors: ValidationError[];
  
  constructor(errors: ValidationError[]) {
    const messages = errors.map(e => `${e.field}: ${e.message}`).join('; ');
    super(`Validation failed: ${messages}`);
    this.name = 'DomainValidationError';
    this.errors = errors;
  }
}

export function normalizeToDateOnly(date: Date | string | null | undefined): Date | null {
  if (date == null) return null;
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getTodayDateOnly(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export function isDateInFuture(date: Date | null): boolean {
  if (!date) return false;
  const normalized = normalizeToDateOnly(date);
  const today = getTodayDateOnly();
  return normalized !== null && normalized > today;
}

export function isStartAfterEnd(startDate: Date | null, endDate: Date | null): boolean {
  if (!startDate || !endDate) return false;
  const start = normalizeToDateOnly(startDate);
  const end = normalizeToDateOnly(endDate);
  return start !== null && end !== null && start > end;
}

export function isDateExpired(endDate: Date | null): boolean {
  if (!endDate) return false;
  const end = normalizeToDateOnly(endDate);
  const today = getTodayDateOnly();
  return end !== null && end < today;
}

export function isDateWithinRange(startDate: Date | null, endDate: Date | null): boolean {
  if (!startDate || !endDate) return false;
  const start = normalizeToDateOnly(startDate);
  const end = normalizeToDateOnly(endDate);
  const today = getTodayDateOnly();
  return start !== null && end !== null && start <= today && today <= end;
}

export function throwIfInvalid<T>(result: ValidationResult<T>): T {
  if (!result.ok) {
    throw new DomainValidationError(result.errors);
  }
  return result.value;
}
