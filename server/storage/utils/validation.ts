/**
 * Storage Layer Validation Framework
 * ===================================
 * 
 * This module provides a reusable validation pattern for storage layers.
 * Each storage module should export a single `validate` object created with `createStorageValidator`.
 * 
 * ## Pattern Overview
 * 
 * 1. Define a validator using `createStorageValidator<TInput, TExisting, TDerived>()`
 *    - TInput: The insert schema type (e.g., InsertWorkerBan)
 *    - TExisting: The existing record type for updates (e.g., WorkerBan)
 *    - TDerived: Computed fields returned by validation (e.g., { active: boolean })
 * 
 * 2. The validator logic function receives:
 *    - data: Partial input data being validated
 *    - existing: Optional existing record (for updates)
 *    
 * 3. Return either:
 *    - { ok: true, value: { ...derivedFields } } on success
 *    - { ok: false, errors: ValidationError[] } on failure
 * 
 * ## Usage in Storage Layers
 * 
 * ```typescript
 * // Export a single validate object
 * export const validate = createStorageValidator<InsertWorkerBan, WorkerBan, { active: boolean }>(
 *   (data, existing) => {
 *     const errors: ValidationError[] = [];
 *     // ... validation logic ...
 *     if (errors.length > 0) return { ok: false, errors };
 *     return { ok: true, value: { active: computedActive } };
 *   }
 * );
 * 
 * // In create/update methods:
 * async create(data: InsertWorkerBan) {
 *   const validated = validate.validateOrThrow(data);
 *   // validated includes original data + derived fields (e.g., active)
 *   await db.insert(table).values({ ...data, active: validated.active });
 * }
 * ```
 * 
 * ## Benefits
 * 
 * - Consistent validation pattern across all storage layers
 * - Type-safe derived fields (computed values like `active`)
 * - Single point of validation logic per entity
 * - Enforces validation before persistence
 */

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
