import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { baoDcSummaryPlugin } from "../../server/plugins/dashboard/plugins/bao-dc-summary";

describe("Disability Credit dashboard draft contract", () => {
  it("ships the draft count and does not ship net grant activity", async () => {
    const source = await readFile(
      new URL("../../server/plugins/dashboard/plugins/bao-dc-summary.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("draftCount: drafts.length");
    expect(source).not.toContain("getDcNetGrantActivity");
    expect(source).not.toMatch(/\bnetActivity[,}]/);
    expect(baoDcSummaryPlugin.requiredPolicy).toBe("staff");
    expect(baoDcSummaryPlugin.requiredComponent).toBe("sitespecific.bao");
  });

  it("presents the draft count/link and no net activity section", async () => {
    const source = await readFile(
      new URL(
        "../../client/src/plugins/dashboard/bao-dc-summary/BaoDcSummary.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(source).toContain('data-testid="badge-dc-draft-count"');
    expect(source).toContain('href="/bao/dc/drafts"');
    expect(source).toContain('data-testid="link-dc-open-queue"');
    expect(source).not.toContain("Net grant activity (recent months)");
    expect(source).not.toContain("list-dc-net-activity");
  });
});