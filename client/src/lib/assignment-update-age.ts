/** Format an assignment's real modification date, never inventing one for legacy rows. */
export function assignmentUpdateAge(updatedAt: string | null | undefined, now: number): string {
  if (!updatedAt) return "(Update time unavailable)";
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(updated) || updated > now + 60_000) return "(Update time unavailable)";

  const totalMinutes = Math.max(0, Math.floor((now - updated) / 60_000));
  if (totalMinutes === 0) return "(Updated less than a minute ago)";

  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    days && `${days} ${days === 1 ? "day" : "days"}`,
    hours && `${hours} ${hours === 1 ? "hour" : "hours"}`,
    minutes && `${minutes} ${minutes === 1 ? "minute" : "minutes"}`,
  ].filter(Boolean);
  return `(Updated ${parts.join(" ")} ago)`;
}