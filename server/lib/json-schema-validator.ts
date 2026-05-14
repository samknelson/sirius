import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { JsonSchema } from "@shared/json-schema-form";

/**
 * Shared AJV instance for server-side validation of plugin configs and
 * other JSON Schema-described payloads. Tuned to match RJSF's defaults
 * (additional properties allowed; missing fields treated as undefined).
 *
 * Use `validateAgainstSchema` to validate a single payload; the helper
 * compiles and caches per-schema validators internally.
 */
const ajv = new Ajv({
  allErrors: true,
  strict: false,
  useDefaults: true,
  removeAdditional: false,
});
addFormats(ajv);

const compiledCache = new WeakMap<object, ValidateFunction>();

function compile(schema: JsonSchema): ValidateFunction {
  const cached = compiledCache.get(schema as object);
  if (cached) return cached;
  const fn = ajv.compile(schema as object);
  compiledCache.set(schema as object, fn);
  return fn;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors?: string[];
}

export function validateAgainstSchema(
  schema: JsonSchema,
  payload: unknown,
): JsonSchemaValidationResult {
  const validate = compile(schema);
  const ok = validate(payload);
  if (ok) return { valid: true };
  return {
    valid: false,
    errors: (validate.errors ?? []).map(formatAjvError),
  };
}

function formatAjvError(err: ErrorObject): string {
  const where = err.instancePath || "/";
  return `${where} ${err.message ?? "is invalid"}`;
}
