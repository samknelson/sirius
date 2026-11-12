// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { benefitConfigurationError, mappedBenefitFieldIds } from "@shared/gbhet-legal-benefits";
import { missingMappingGroups } from "@shared/feed-mapping-requirements";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
import { GbhetBenefits, initialBenefitConfiguration } from "../../client/src/components/wizards/framework/GbhetBenefits";
import { FeedMap } from "../../client/src/components/wizards/framework/feed/FeedMap";

const fields = [
  { id: "legal-benefit", type: "benefit", isBenefitEligibility: true, name: "Legal eligibility", required: false },
];
const benefits = [
  { id: "unrelated", name: "Medical benefit", isActive: true },
  { id: "legal", name: "Legal benefit", isActive: true },
];
const activeIds = new Set(benefits.filter((benefit) => benefit.isActive).map((benefit) => benefit.id));
const setup = {
  fields,
  benefits,
  defaultBenefit: { id: "legal", name: "Legal benefit" },
  defaultBenefitWarning: null,
};

describe("GBHET Legal benefit mapping", () => {
  it("uses the server's Legal default rather than the unrelated first active benefit", () => {
    expect(initialBenefitConfiguration(["legal-benefit"], [], setup.defaultBenefit, activeIds)).toEqual([
      { fieldId: "legal-benefit", benefitId: "legal", benefitName: "Legal benefit" },
    ]);
  });

  it("leaves an unmapped association for an explicit choice when no default exists", () => {
    const config = initialBenefitConfiguration(["legal-benefit"], [], null, activeIds);
    expect(config).toEqual([]);
    expect(benefitConfigurationError(["legal-benefit"], config, activeIds)).toContain("Choose and save");
  });

  it("preserves a saved explicit association over the server default", () => {
    const saved = [{ fieldId: "legal-benefit", benefitId: "unrelated", benefitName: "Medical benefit" }];
    expect(initialBenefitConfiguration(["legal-benefit"], saved, setup.defaultBenefit, activeIds)).toEqual(saved);
  });

  it("does not accept zero mapped benefit fields as a valid configuration", () => {
    expect(mappedBenefitFieldIds(fields, {})).toEqual([]);
    expect(benefitConfigurationError([], [], activeIds)).toContain("Map at least one");
  });

  it("gates mappings only for required groups supplied by the dispatcher", () => {
    const mapping = { "legal-benefit": "col_0" };
    expect(missingMappingGroups(mapping)).toEqual([]);
    const requiredFieldGroups = [{
      fieldIds: ["legal-benefit"],
      message: "Map a Benefit Eligibility field for this upload.",
    }];
    expect(missingMappingGroups({ "legal-benefit": "_unmapped" }, requiredFieldGroups)).toEqual(requiredFieldGroups);
    expect(missingMappingGroups(mapping, requiredFieldGroups)).toEqual([]);
  });
});

describe("wizard feed mapping smoke checks", () => {
  let host: HTMLDivElement;
  let root: Root;
  let client!: QueryClient;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
  });

  async function renderWithData(node: React.ReactNode, queryKey: unknown[], queryData: unknown) {
    client = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: async () => queryData,
        },
      },
    });
    client.setQueryData(queryKey, queryData);
    await act(async () => {
      root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }

  it("shows the required-map warning and offers no save action when no benefit fields are mapped", async () => {
    await renderWithData(
      <GbhetBenefits
        wizardId="upload-1"
        wizardType="gbhet_legal_workers_monthly"
        step={{ id: "benefits", name: "Benefits", kind: "component", state: "in_progress" }}
        data={{ columnMapping: {} }}
      />,
      ["/api/wizards", "upload-1", "dispatch", "benefits", "data"],
      setup,
    );
    expect(host.textContent).toContain("No benefit eligibility fields mapped");
    expect(host.textContent).toContain("Map at least one uploaded column");
    expect(host.querySelector('[data-testid="button-save-benefits"]')).toBeNull();
  });

  it("disables FeedMap save for supplied groups, but not when no groups are supplied", async () => {
    const base = {
      fields: [{ id: "name", name: "Worker name", required: false }],
      previewRows: [],
      columnCount: 1,
      fileName: "workers.csv",
      columnMapping: {},
      mode: "create" as const,
      hasHeaders: true,
    };
    await renderWithData(
      <FeedMap wizardId="upload-1" wizardType="gbhet_legal_workers_monthly" step={{ id: "map", name: "Map", kind: "component", state: "in_progress" }} />,
      ["/api/wizards", "upload-1", "dispatch", "map", "data"],
      base,
    );
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-save-mapping"]')?.disabled).toBe(false);

    await act(async () => root.unmount());
    root = createRoot(host);
    await renderWithData(
      <FeedMap wizardId="upload-2" wizardType="gbhet_legal_workers_monthly" step={{ id: "map", name: "Map", kind: "component", state: "in_progress" }} />,
      ["/api/wizards", "upload-2", "dispatch", "map", "data"],
      {
        ...base,
        requiredFieldGroups: [{
          fieldIds: ["benefit-eligibility"],
          message: "Map a Benefit Eligibility field for this upload.",
        }],
      },
    );
    expect(host.textContent).toContain("Map a Benefit Eligibility field for this upload.");
    expect(host.querySelector<HTMLButtonElement>('[data-testid="button-save-mapping"]')?.disabled).toBe(true);
  });
});
