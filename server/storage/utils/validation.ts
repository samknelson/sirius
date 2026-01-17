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

declare const ValidatedBrand: unique symbol;

/**
 * A branded type that represents validated data.
 * Can only be created by calling a validator's validate() function.
 * This ensures create/update methods can only accept data that has passed validation.
 */
export type Validated<T> = T & { readonly [ValidatedBrand]: true };

/**
 * Type for the validation logic function.
 * TInput: The input data type (insert schema)
 * TExisting: The existing record type (for updates, undefined for creates)
 * TDerived: Computed fields returned by validation (e.g., { active: boolean })
 */
export type ValidatorLogic<TInput, TExisting, TDerived> = (
  data: Partial<TInput>,
  existing?: TExisting
) => ValidationResult<TDerived>;

/**
 * Interface for a storage layer validator.
 * Provides a single validate() function that returns Validated<T> on success.
 */
export interface StorageValidator<TInput, TExisting, TDerived> {
  validate(data: Partial<TInput>, existing?: TExisting): ValidationResult<Validated<Partial<TInput> & TDerived>>;
  validateOrThrow(data: Partial<TInput>, existing?: TExisting): Validated<Partial<TInput> & TDerived>;
}

/**
 * Creates a storage validator with a single validate() function.
 * The validator combines the input data with derived fields computed by the logic function.
 * 
 * @example
 * const validator = createStorageValidator<InsertWorkerBan, WorkerBan, { active: boolean }>(
 *   (data, existing) => {
 *     const errors: ValidationError[] = [];
 *     // ... validation logic ...
 *     if (errors.length > 0) return { ok: false, errors };
 *     return { ok: true, value: { active: computedActive } };
 *   }
 * );
 * 
 * // In create/update:
 * const validated = validator.validateOrThrow(data);
 * // validated is now Validated<Partial<InsertWorkerBan> & { active: boolean }>
 */
export function createStorageValidator<TInput, TExisting, TDerived>(
  logic: ValidatorLogic<TInput, TExisting, TDerived>
): StorageValidator<TInput, TExisting, TDerived> {
  return {
    validate(data: Partial<TInput>, existing?: TExisting): ValidationResult<Validated<Partial<TInput> & TDerived>> {
      const result = logic(data, existing);
      if (!result.ok) {
        return result;
      }
      const merged = { ...data, ...result.value } as Validated<Partial<TInput> & TDerived>;
      return { ok: true, value: merged };
    },
    
    validateOrThrow(data: Partial<TInput>, existing?: TExisting): Validated<Partial<TInput> & TDerived> {
      const result = this.validate(data, existing);
      if (!result.ok) {
        throw new DomainValidationError(result.errors);
      }
      return result.value;
    }
  };
}
