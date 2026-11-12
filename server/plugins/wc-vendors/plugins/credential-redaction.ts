const REDACTED = "[REDACTED]";

/** Remove a configured credential from remote-controlled text before it leaves a handler. */
export function redactCredentialText(text: string, credential: string): string {
  if (!credential) return text;
  const spellings = new Set([
    credential,
    encodeURIComponent(credential),
    JSON.stringify(credential).slice(1, -1),
  ]);
  let redacted = text;
  for (const spelling of spellings) {
    if (spelling) redacted = redacted.split(spelling).join(REDACTED);
  }
  return redacted;
}

/** Recursively scrub strings in a parsed remote response before caching or returning it. */
export function redactCredentialValue<T>(value: T, credential: string): T {
  if (typeof value === "string") {
    return redactCredentialText(value, credential) as T;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactCredentialValue(entry, credential)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        redactCredentialText(key, credential),
        redactCredentialValue(entry, credential),
      ]),
    ) as T;
  }
  return value;
}