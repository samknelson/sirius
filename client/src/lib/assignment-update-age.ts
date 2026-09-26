/** Format only recorded assignment metadata; do not invent a legacy revision or date. */
export function assignmentUpdateAge(
  updatedAt: string | null | undefined,
  now: number,
  revision: number | null | undefined,
): string {
  const revisionLabel = Number.isSafeInteger(revision) && revision! > 0
    ? `Rev. #${revision}`
    : "Revision unavailable";
  let age = "update time unavailable";
  const updated = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isFinite(updated) && Number.isFinite(now) && updated <= now + 60_000) {
    const totalMinutes = Math.max(0, Math.floor((now - updated) / 60_000));
    if (totalMinutes === 0) {
      age = "updated less than a minute ago";
    } else if (totalMinutes < 60) {
      age = `updated ${totalMinutes} ${totalMinutes === 1 ? "minute" : "minutes"} ago`;
    } else {
      const days = Math.floor(totalMinutes / (24 * 60));
      const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
      const parts = [
        days && `${days} ${days === 1 ? "day" : "days"}`,
        hours && `${hours} ${hours === 1 ? "hour" : "hours"}`,
      ].filter(Boolean);
      age = `updated ${parts.join(" ")} ago`;
    }
  }
  return `(${revisionLabel}, ${age})`;
}