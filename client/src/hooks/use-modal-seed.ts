import { useState } from "react";

/**
 * Seed a dialog's local form state from the record it was opened for, during
 * the render that opens it.
 *
 * Dialogs used to do this in `useEffect(..., [open, record])`. That runs one
 * render too late: the dialog body (an RJSF form, a controlled input tree)
 * mounts inside the portal from the still-empty state and initializes itself
 * from it, and the seeding that lands afterwards no longer reaches what the
 * body captured — the first open after a page load shows blanks, while a
 * reopen looks right only because the previous session left the state behind.
 *
 * Seeding here happens in the render phase, before the body has rendered at
 * all, so the body's first render already sees the record's values. This is
 * React's supported "adjusting state when a prop changes" pattern: `seed()`
 * sets state on the calling component during its own render, which React
 * re-runs immediately without committing the discarded output.
 *
 * A session is `open` plus `recordKey`, so opening the dialog again for a
 * different record re-seeds from that record rather than keeping the previous
 * one. `recordKey` is the caller's choice of "which record, in which shape" —
 * include anything the seed reads that can arrive late (metadata that shapes
 * the seeded value), and nothing that merely changes as the user edits.
 *
 * @param open - Whether the dialog is open.
 * @param recordKey - Identifies the record/shape being seeded; a change while
 *   open re-seeds.
 * @param seed - Sets the caller's state from the record. Must only call the
 *   caller's own state setters.
 */
export function useModalSeed(
  open: boolean,
  recordKey: string | number | null | undefined,
  seed: () => void,
): void {
  // Distinct from every real session, so a dialog that mounts already open
  // (the common case: the dialog element only exists once something is being
  // edited) seeds on its very first render.
  const [seededSession, setSeededSession] = useState<string | null>(null);
  const session = open ? `open:${recordKey ?? ""}` : null;
  if (session !== seededSession) {
    setSeededSession(session);
    if (open) seed();
  }
}
