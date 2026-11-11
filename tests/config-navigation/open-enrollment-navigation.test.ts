import { describe, expect, it } from "vitest";
import { configSections, hasAccessToItem } from "../../client/src/config/navigation-registry";

const openEnrollmentWindows = configSections
  .flatMap((section) => section.items)
  .find((item) => item.path === "/config/trust/open-enrollment-windows")!;

describe("Open Enrollment window navigation", () => {
  it("shows the link only when BAO and Trust Elections are enabled", () => {
    const context = (enabled: string[]) => ({
      hasPermission: () => true,
      policyResults: {},
      isComponentEnabled: (id: string) => enabled.includes(id),
    });

    expect(
      hasAccessToItem(openEnrollmentWindows, context(["sitespecific.bao", "trust.elections"])),
    ).toBe(true);
    expect(
      hasAccessToItem(openEnrollmentWindows, context(["trust.elections"])),
    ).toBe(false);
    expect(
      hasAccessToItem(openEnrollmentWindows, context(["sitespecific.bao"])),
    ).toBe(false);
  });
});
