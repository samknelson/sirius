import { redactTaxIdRecord } from "@shared/utils/worker-tax-identity";

/** Response previews are diagnostic copies, never a second sensitive-ID store. */
export function redactSensitiveData(data: any): any {
  if (!data || typeof data !== "object") return data;
  const sensitiveFields = ["ssn", "password", "token", "secret", "accesscode", "accessuuid"];
  const redacted = Array.isArray(data) ? [...data] : { ...redactTaxIdRecord(data) };
  for (const key in redacted) {
    if (sensitiveFields.includes(key.toLowerCase())) redacted[key] = "[REDACTED]";
    else if (typeof redacted[key] === "object" && redacted[key] !== null) redacted[key] = redactSensitiveData(redacted[key]);
  }
  return redacted;
}
