/**
 * Notes display controls: the shared notes panel's expand/collapse model and
 * the note card's two body renderings.
 *
 * Guards the behaviors staff rely on when scanning a record's notes:
 *   - complete bodies by default (a card change must not restore truncation),
 *   - Collapse all / Expand all move EVERY note and reset individual choices,
 *   - an individual toggle moves ONLY its note,
 *   - compact mode previews the body's first non-blank line (empty and
 *     single-line bodies included), and
 *   - type, imported marker, subject, author, timestamp, tags and actions
 *     stay visible in BOTH states.
 *
 * The state model is pure (client/src/components/entity-notes/note-display.ts) and
 * the card is presentational, so both are exercised here without a DOM:
 * static markup is enough to prove what each state renders.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import NoteCard, { type NoteRow } from "@/components/entity-notes/NoteCard";
import {
  collapseAll,
  expandAll,
  firstLineOf,
  initialNotesDisplayState,
  isNoteExpanded,
  toggleNote,
  type NotesDisplayState,
} from "@/components/entity-notes/note-display";

describe("notes display state model", () => {
  const ids = ["n1", "n2", "n3"];

  it("shows every note's complete body by default", () => {
    for (const id of ids) {
      expect(isNoteExpanded(initialNotesDisplayState, id)).toBe(true);
    }
  });

  it("collapse all compacts every note; expand all restores every note", () => {
    const collapsed = collapseAll();
    for (const id of ids) expect(isNoteExpanded(collapsed, id)).toBe(false);
    const expanded = expandAll();
    for (const id of ids) expect(isNoteExpanded(expanded, id)).toBe(true);
  });

  it("toggling one note never moves any other note", () => {
    let state: NotesDisplayState = initialNotesDisplayState;
    state = toggleNote(state, "n2");
    expect(isNoteExpanded(state, "n1")).toBe(true);
    expect(isNoteExpanded(state, "n2")).toBe(false);
    expect(isNoteExpanded(state, "n3")).toBe(true);

    // And back again, still alone.
    state = toggleNote(state, "n2");
    for (const id of ids) expect(isNoteExpanded(state, id)).toBe(true);
  });

  it("individual toggles override the page default in either direction", () => {
    let state = collapseAll();
    state = toggleNote(state, "n1");
    expect(isNoteExpanded(state, "n1")).toBe(true);
    expect(isNoteExpanded(state, "n2")).toBe(false);
  });

  it("bulk actions reset earlier individual choices", () => {
    let state = toggleNote(initialNotesDisplayState, "n1"); // n1 collapsed
    state = expandAll();
    expect(isNoteExpanded(state, "n1")).toBe(true);

    state = toggleNote(collapseAll(), "n2"); // n2 expanded against a collapsed page
    state = collapseAll();
    expect(isNoteExpanded(state, "n2")).toBe(false);
  });
});

describe("first-line preview extraction", () => {
  it("handles missing and empty bodies without a preview", () => {
    expect(firstLineOf(null)).toEqual({ preview: null, hasMore: false });
    expect(firstLineOf(undefined)).toEqual({ preview: null, hasMore: false });
    expect(firstLineOf("")).toEqual({ preview: null, hasMore: false });
    expect(firstLineOf("   \n\t\n ")).toEqual({ preview: null, hasMore: false });
  });

  it("previews a single-line body without an ellipsis flag", () => {
    expect(firstLineOf("Only line")).toEqual({ preview: "Only line", hasMore: false });
  });

  it("previews the first non-blank line of a multi-line body", () => {
    expect(firstLineOf("First line\nSecond line\nThird")).toEqual({
      preview: "First line",
      hasMore: true,
    });
    // Leading blank lines are skipped, CRLF endings are handled.
    expect(firstLineOf("\r\n  \r\nActual start\r\nrest")).toEqual({
      preview: "Actual start",
      hasMore: true,
    });
  });

  it("does not flag more content when only blank lines follow", () => {
    expect(firstLineOf("Line\n\n   \n")).toEqual({ preview: "Line", hasMore: false });
  });
});

describe("note card rendering in both states", () => {
  const note: NoteRow = {
    id: "note-1",
    contextId: "worker",
    entityId: "w-1",
    typeId: "t-1",
    subject: "Call about eligibility",
    body: "Spoke with the member.\nThey will send the form.\nFollow up Friday.",
    data: { s1Loader: "log-notes" },
    timestamp: "2026-08-27T15:30:00.000Z",
    userId: "u-1",
    typeName: "Member Inbound",
    authorName: "Maria Garcia",
    tags: [
      {
        id: "tag-1",
        name: "Enrollment",
        tagTypeId: "tt-1",
        tagTypeName: "Issue",
        tagTypeSequence: 1,
      },
    ],
    caseId: null,
  };

  function render(overrides: Partial<NoteRow>, expanded: boolean, tagsEnabled = true) {
    return renderToStaticMarkup(
      <Router ssrPath="/">
        <NoteCard
          note={{ ...note, ...overrides }}
          tagsEnabled={tagsEnabled}
          contextId={note.contextId}
          entityId={note.entityId}
          expanded={expanded}
          onToggleExpanded={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </Router>,
    );
  }

  it("expanded shows the complete body, no preview element", () => {
    const html = render({}, true);
    expect(html).toContain("Spoke with the member.");
    expect(html).toContain("Follow up Friday.");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain(`text-note-body-${note.id}`);
    expect(html).not.toContain(`text-note-preview-${note.id}`);
  });

  it("collapsed shows only the first line of the body", () => {
    const html = render({}, false);
    expect(html).toContain(`text-note-preview-${note.id}`);
    expect(html).toContain("Spoke with the member.…");
    expect(html).not.toContain("Follow up Friday.");
    expect(html).not.toContain(`text-note-body-${note.id}`);
  });

  it("collapsed single-line body previews without an ellipsis", () => {
    const html = render({ body: "Just one line" }, false);
    expect(html).toContain("Just one line");
    expect(html).not.toContain("Just one line…");
  });

  it("renders no body element at all for an empty body, in either state", () => {
    for (const expanded of [true, false]) {
      const html = render({ body: null }, expanded);
      expect(html).not.toContain(`text-note-body-${note.id}`);
      expect(html).not.toContain(`text-note-preview-${note.id}`);
    }
  });

  it("keeps type, imported marker, subject, author, timestamp, tags and actions in BOTH states", () => {
    for (const expanded of [true, false]) {
      const html = render({}, expanded);
      expect(html).toContain("Member Inbound"); // type badge
      expect(html).toContain(`badge-note-imported-${note.id}`); // import provenance
      expect(html).toContain("Call about eligibility"); // subject
      expect(html).toContain("Maria Garcia"); // author
      expect(html).toContain("Aug 27, 2026"); // timestamp
      expect(html).toContain("Issue: Enrollment"); // BAO tag with its type
      expect(html).toContain(`button-edit-note-${note.id}`);
      expect(html).toContain(`button-delete-note-${note.id}`);
      expect(html).toContain(`button-create-case-note-${note.id}`);
      expect(html).toContain(`button-toggle-note-${note.id}`);
    }
  });

  it("does not mark a hand-written note as imported", () => {
    const html = render({ data: null }, true);
    expect(html).not.toContain(`badge-note-imported-${note.id}`);
  });

  it("announces the toggle's state to assistive technology", () => {
    const expanded = render({}, true);
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain('aria-label="Collapse note"');
    const collapsed = render({}, false);
    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain('aria-label="Expand note"');
    // The toggle points at the body element it controls.
    expect(expanded).toContain(`aria-controls="note-body-${note.id}"`);
    expect(expanded).toContain(`id="note-body-${note.id}"`);
  });
});
