import { describe, expect, it } from "vitest";
import { buildDefaultMenuTree } from "../../server/plugins/menu/plugins/default";

describe("default Workers navigation", () => {
  it("offers staff COBRA cases inside Workers rather than as a top-level button", () => {
    const menu = buildDefaultMenuTree();
    const workers = menu.find((item) => item.id === "workers");
    const cobra = workers?.children?.find((item) => item.id === "bao-cobra-cases");

    expect(menu.some((item) => item.id === "bao-cobra-cases")).toBe(false);
    expect(cobra).toMatchObject({
      label: "COBRA",
      href: "/cobra/cases",
      active: { type: "prefix", value: "/cobra" },
      gate: { allOf: [{ component: "sitespecific.bao" }, { policy: "staff" }] },
    });
    expect(workers?.gate).toMatchObject({
      anyOf: expect.arrayContaining([{ policy: "staff" }]),
    });
  });
});