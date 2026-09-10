import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  snapshotRevisionFromNode,
  snapshotRevisionFromValues,
} from "../../shared/snapshots";
import {
  formatSnapshotRevision,
  SnapshotRevision,
} from "../../client/src/components/snapshots/SnapshotRevision";

const browserSource = readFileSync(
  "client/src/components/snapshots/SnapshotBrowser.tsx",
  "utf8",
);

describe("snapshot revision identity", () => {
  it("normalizes captured sequence and revision values", () => {
    expect(snapshotRevisionFromValues("1810", "3")).toEqual({ seq: 1810, rev: 3 });
    expect(snapshotRevisionFromNode({ metadata: { seq: 1810, rev: 3 } })).toEqual({
      seq: 1810,
      rev: 3,
    });
  });

  it("returns no revision for legacy, incomplete, or invalid metadata", () => {
    expect(snapshotRevisionFromNode({ version: 1, data: {} })).toBeNull();
    expect(snapshotRevisionFromValues("1810", null)).toBeNull();
    expect(snapshotRevisionFromValues(0, 3)).toBeNull();
    expect(snapshotRevisionFromValues("not-a-number", 3)).toBeNull();
  });

  it("formats the same revision ID used by record-history badges", () => {
    expect(formatSnapshotRevision({ seq: 1810, rev: 3 })).toBe("000.1810::0003");
    expect(formatSnapshotRevision(null)).toBe("Revision not recorded");

    const populated = renderToStaticMarkup(
      createElement(SnapshotRevision, {
        revision: { seq: 1810, rev: 3 },
        testId: "revision",
      }),
    );
    expect(populated).toContain("000.1810::0003");
  });

  it("uses the revision badge in both list rows and the selected header", () => {
    expect(browserSource).toContain("revision={snapshot.revision}");
    expect(browserSource).toContain("revision={selected.revision}");
  });
});