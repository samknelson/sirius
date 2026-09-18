/**
 * Format an S1 migration run's elapsed time.
 *
 * Short runs retain the history table's existing tenth-of-a-second precision.
 * Runs of at least one minute use whole seconds split across all units from the
 * largest non-zero unit down, including intermediate zeroes for readability.
 */
export function formatS1RunDuration(startedAt: string, finishedAt: string): string {
  const startedMs = new Date(startedAt).getTime();
  const finishedMs = new Date(finishedAt).getTime();
  if (Number.isNaN(startedMs) || Number.isNaN(finishedMs)) return "—";

  const elapsedMs = Math.max(0, finishedMs - startedMs);
  if (elapsedMs < 60_000) {
    return `${Math.round(elapsedMs / 100) / 10}s`;
  }

  const totalSeconds = Math.floor(elapsedMs / 1_000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  return `${minutes}m ${seconds}s`;
}