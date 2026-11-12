import { describe, expect, it } from "vitest";
import { assignmentUpdateAge } from "../../client/src/lib/assignment-update-age";

const NOW = Date.parse("2026-09-24T18:00:00.000Z");

describe("assignment update age", () => {
  it.each([
    [NOW - 10_000, "(Rev. #4, updated less than a minute ago)"],
    [NOW - 60_000, "(Rev. #4, updated 1 minute ago)"],
    [NOW - 59 * 60_000, "(Rev. #4, updated 59 minutes ago)"],
    [NOW - 60 * 60_000, "(Rev. #4, updated 1 hour ago)"],
    [NOW - (2 * 60 + 12) * 60_000, "(Rev. #4, updated 2 hours ago)"],
    [NOW - (24 * 60 + 61) * 60_000, "(Rev. #4, updated 1 day 1 hour ago)"],
    [NOW - (46 * 60 + 33) * 60_000, "(Rev. #4, updated 1 day 22 hours ago)"],
    [NOW - 2 * 24 * 60 * 60_000, "(Rev. #4, updated 2 days ago)"],
  ])("formats a real update %s", (instant, expected) => {
    expect(assignmentUpdateAge(new Date(instant).toISOString(), NOW, 4)).toBe(expected);
  });

  it("recalculates as the clock advances without a new response", () => {
    const updatedAt = new Date(NOW).toISOString();
    expect(assignmentUpdateAge(updatedAt, NOW, 4)).toBe("(Rev. #4, updated less than a minute ago)");
    expect(assignmentUpdateAge(updatedAt, NOW + 2 * 60_000, 4)).toBe("(Rev. #4, updated 2 minutes ago)");
  });

  it.each([null, "", "not a date", new Date(NOW + 2 * 60_000).toISOString()])(
    "does not invent an age for absent, invalid or implausible date %s",
    (value) => {
      expect(assignmentUpdateAge(value, NOW, 4)).toBe("(Rev. #4, update time unavailable)");
    },
  );

  it.each([null, 0, -2, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "does not invent a revision for missing or invalid value %s",
    (revision) => {
      expect(assignmentUpdateAge(new Date(NOW - 60_000).toISOString(), NOW, revision))
        .toBe("(Revision unavailable, updated 1 minute ago)");
    },
  );
  it("marks both values unavailable for legacy rows", () => {
    expect(assignmentUpdateAge(null, NOW, null)).toBe("(Revision unavailable, update time unavailable)");
  });
});