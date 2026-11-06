import { describe, expect, it } from "vitest";
import { normalizeWorkerDirectoryFilters } from "@shared/worker-directory-filters";
import { serializeQueryKey } from "@/lib/queryClient";
import { getSystemHelp, getAllSystemHelps, findSystemHelpsForPath } from "../../server/help/system";

describe("directory request normalization", () => {
  it("keeps GET and body-based sensitive request arrays equivalent", () => {
    const filters = { employerIds: ["A", "B"], employmentMode: "custom", employmentStatusIds: ["leave"], bargainingUnitIds: ["unit"], workStatusIds: ["active"], benefitIds: ["medical"], memberStatusIds: ["member"], representativeIds: ["rep"] };
    const query = Object.fromEntries(new URL(serializeQueryKey(["/workers", filters]), "https://example.invalid").searchParams);
    expect(normalizeWorkerDirectoryFilters(query)).toEqual(normalizeWorkerDirectoryFilters(filters));
  });
  it("empty and None action values remove a restriction", () => {
    expect(normalizeWorkerDirectoryFilters({ employerIds: [], bargainingUnitIds: "", employmentMode: "custom", employmentStatusIds: ["leave"] })).toEqual({});
  });
  it("preserves restored legacy singular employment intent", () => {
    expect(normalizeWorkerDirectoryFilters({ employerId: "A" })).toEqual({});
    expect(normalizeWorkerDirectoryFilters({ employerId: "A", employmentMode: "ever" })).toEqual({ employmentMode: "ever" });
  });
  it.each([
    { employmentMode: "anything" }, { employerIds: [5] }, { workStatusActive: "maybe" },
    { bargainingUnitIds: { id: "unit" } }, { benefitIds: Array(1001).fill("id") },
  ])("rejects malformed inputs instead of widening the population: %j", input => {
    expect(() => normalizeWorkerDirectoryFilters(input)).toThrow();
  });
  it("registers sanitized directory help narrowly without replacing local guidance", () => {
    const help = getSystemHelp("system:worker-directory");
    expect(help?.source).toBe("system");
    expect(getAllSystemHelps()).toContain(help);
    expect(findSystemHelpsForPath("/workers")).toContain(help);
    expect(findSystemHelpsForPath("/workers/add")).toContain(help);
    for (const path of ["/workers/worker-id", "/workers/", "/employers", "/config/helps"]) {
      expect(findSystemHelpsForPath(path)).not.toContain(help);
    }
    expect(help?.details).toContain("<strong>Currently employed, including leave</strong>");
    expect(help?.details).toContain("<strong>None</strong>");
    expect(help?.details).not.toContain("<script");
  });
});
