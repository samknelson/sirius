/**
 * Display-state model for the shared notes panel.
 *
 * Every note opens with its complete body visible. The page-level
 * Collapse all / Expand all controls set a new default for EVERY note and
 * wipe any per-note choices; an individual toggle after that overrides the
 * default for that one note only. Nothing here persists — the state lives
 * in the panel and resets on every mount, deliberately.
 */

export interface NotesDisplayState {
  /** Default for notes without an individual override. */
  allExpanded: boolean;
  /** Per-note overrides made since the last bulk action. */
  overrides: Record<string, boolean>;
}

/** Complete bodies by default — compacting is always an explicit action. */
export const initialNotesDisplayState: NotesDisplayState = {
  allExpanded: true,
  overrides: {},
};

/** Page-level Expand all: every note expanded, individual choices cleared. */
export function expandAll(): NotesDisplayState {
  return { allExpanded: true, overrides: {} };
}

/** Page-level Collapse all: every note compact, individual choices cleared. */
export function collapseAll(): NotesDisplayState {
  return { allExpanded: false, overrides: {} };
}

export function isNoteExpanded(state: NotesDisplayState, noteId: string): boolean {
  return state.overrides[noteId] ?? state.allExpanded;
}

/** Flip ONE note relative to what it currently shows; no other note moves. */
export function toggleNote(state: NotesDisplayState, noteId: string): NotesDisplayState {
  return {
    allExpanded: state.allExpanded,
    overrides: { ...state.overrides, [noteId]: !isNoteExpanded(state, noteId) },
  };
}

/**
 * Compact-mode preview: the first non-blank line of the body, plus whether
 * further content exists beyond it (drives the trailing ellipsis). A missing,
 * empty, or whitespace-only body previews as nothing at all.
 */
export function firstLineOf(body: string | null | undefined): {
  preview: string | null;
  hasMore: boolean;
} {
  if (!body) return { preview: null, hasMore: false };
  const lines = body.split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() !== "");
  if (index === -1) return { preview: null, hasMore: false };
  return {
    preview: lines[index].trim(),
    hasMore: lines.slice(index + 1).some((line) => line.trim() !== ""),
  };
}
