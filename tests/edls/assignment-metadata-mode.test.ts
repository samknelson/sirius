import { describe, expect, it } from "vitest";
import {
  assignmentAnswerMetadataMode,
  assignmentUpdateMetadataMode,
} from "../../server/storage/edls/assignment-provenance";

describe("EDLS assignment modification provenance", () => {
  it("does not advance when an unchanged assignment is saved with null extras", () => {
    expect(assignmentUpdateMetadataMode(
      { data: null },
      { data: { startTime: null } },
    )).toBe("none");
    expect(assignmentUpdateMetadataMode(
      { data: { nested: {} } },
      { data: { nested: { extra: null } } },
    )).toBe("none");
  });

  it("advances for real edits but not for a missing assignment", () => {
    expect(assignmentUpdateMetadataMode({ data: null }, { data: { startTime: "08:00" } })).toBe("modified");
    expect(assignmentUpdateMetadataMode({ data: null }, undefined)).toBe("none");
  });

  it("advances only for a recorded worker answer", () => {
    expect(assignmentAnswerMetadataMode(true)).toBe("modified");
    expect(assignmentAnswerMetadataMode(false)).toBe("none");
  });
});