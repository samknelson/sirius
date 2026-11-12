/** Descriptive, untrusted browser information. Never an identity signal. */
export function suppliedSessionUserAgent(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function sessionHistoryDataObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

export function sessionDeviceUserAgent(data: unknown): string | null {
  return suppliedSessionUserAgent(sessionHistoryDataObject(
    sessionHistoryDataObject(data).device,
  ).user_agent);
}

/** Merge only our field; retain extension data and other device properties. */
export function withSessionUserAgent(data: null | undefined, value: unknown): { device: { user_agent: string } } | null;
export function withSessionUserAgent(data: unknown, value: unknown): unknown;
export function withSessionUserAgent(data: unknown, value: unknown): unknown {
  const userAgent = suppliedSessionUserAgent(value);
  if (userAgent === null) return data ?? null;
  const existing = sessionHistoryDataObject(data);
  return {
    ...existing,
    device: { ...sessionHistoryDataObject(existing.device), user_agent: userAgent },
  };
}
