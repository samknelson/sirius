import type { ComponentContributions } from "../../../shared/component-contributions";
export const contributions: ComponentContributions = { menu: [{
  parent: "trust", before: "benefit-scan",
  node: {
    id: "trust-provider-edi", label: "Provider EDI", icon: "FileOutput",
    href: "/trust/provider-edi", active: { type: "prefix", value: "/trust/provider-edi" },
    testId: "menu-trust-provider-edi",
    gate: { allOf: [{ component: "trust.providers.edi" }, { permission: "admin" }] },
  },
}] };
