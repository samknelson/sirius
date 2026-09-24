import { describe, expect, it } from "vitest";
import { assignmentUpdateAge } from "../../client/src/lib/assignment-update-age";

const NOW = Date.parse("2026-09-24T18:00:00.000Z");

describe("assignment update age", () => {
  it.each([
    [NOW - 10_000, "(Updated less than a minute ago)"],
    [NOW - 60_000, "(Updated 1 minute ago)"],
    [NOW - (2 * 60 + 12) * 60_000, "(Updated 2 hours 12 minutes ago)"],
    [NOW - (24 * 60 + 61) * 60_000, "(Updated 1 day 1 hour 1 minute ago)"],
  ])("formats a real update %s", (instant, expected) => {
    expect(assignmentUpdateAge(new Date(instant).toISOString(), NOW)).toBe(expected);
  });

  it("recalculates as the clock advances without a new response", () => {
    const updatedAt = new Date(NOW).toISOString();
    expect(assignmentUpdateAge(updatedAt, NOW)).toBe("(Updated less than a minute ago)");
    expect(assignmentUpdateAge(updatedAt, NOW + 2 * 60_000)).toBe("(Updated 2 minutes ago)");
  });

  it.each([null, "", "not a date", new Date(NOW + 2 * 60_000).toISOString()])(
    "does not invent an age for absent, invalid or implausible date %s",
    (value) => {
      expect(assignmentUpdateAge(value, NOW)).toBe("(Update time unavailable)");
    },
  );
});