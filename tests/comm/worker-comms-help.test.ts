import { describe, expect, it } from "vitest";
import { findSystemHelpsForPath, getSystemHelp } from "../../server/help/system";
import { workerCommsComplianceHelp } from "../../server/help/system/worker-comms-compliance";
import { sanitizeHtml } from "@shared/utils/html";

describe("worker communication report help", () => {
  it("appears only on the exact report page, not other worker/help/API screens", () => {
    const id = workerCommsComplianceHelp.id;
    expect(findSystemHelpsForPath("/workers/comms-compliance").some(h => h.id === id)).toBe(true);
    for (const path of ["/workers", "/workers/worker", "/workers/comms-compliance/", "/workers/comms-compliance/history",
      "/workers/comms-compliance-other", "/Workers/comms-compliance", "/config/helps", "/api/worker-comms-compliance"]) {
      expect(findSystemHelpsForPath(path).some(h => h.id === id)).toBe(false);
    }
  });
  it("retains meaningful sections through the shared sanitizer and declares the no-send boundary", () => {
    const help = getSystemHelp(workerCommsComplianceHelp.id)!;
    expect(help.source).toBe("system");
    expect(help.details).toBe(sanitizeHtml(workerCommsComplianceHelp.details!, "rich-document"));
    for (const text of ["<h3>Purpose</h3>", "Only admins", "Future-only", "Neither action sends", "inclusive",
      "not proof of physical receipt", "drafts", "recipient/channel"]) expect(help.details).toContain(text);
    expect(help.summary).not.toMatch(/[<>]/);
  });
});
