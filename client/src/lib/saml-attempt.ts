const KEY = "samlSignInStarted";

/** UI hint only, never authentication state or a roundtrip credential. */
export function markSamlAttempt(): void {
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* Storage can be disabled. */ }
}
export function hasRecentSamlAttempt(): boolean {
  try {
    const started = Number(sessionStorage.getItem(KEY));
    return started > 0 && Date.now() >= started && Date.now() - started < 30 * 60_000;
  } catch { return false; }
}
export function clearSamlAttempt(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* UI hint only. */ }
}
