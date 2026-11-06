// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { FrameworkWizardBody } from "@/components/wizards/framework/FrameworkWizardBody";
import type { WizardManifest, WizardStepManifest } from "@/components/wizards/framework/types";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/queryClient", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/queryClient")>(),
  apiRequest: vi.fn(async () => new Response("{}")),
}));
vi.mock("@/plugins/wizards/registry", async () => {
  const { BenefitsStep } = await import("@/components/wizards/framework/enrollment/BenefitsStep");
  const { SignatureStep } = await import("@/components/wizards/framework/enrollment/SignatureStep");
  const { CobraCoveredPeopleStep } = await import("@/plugins/wizards/bao_cobra_enrollment/CobraCoveredPeopleStep");
  const { LifeEventDependentsStep } = await import("@/plugins/wizards/life_event_enrollment/LifeEventDependentsStep");
  return { wizardComponentRegistry: { resolve: (name: string) => {
    if (name.endsWith("BenefitsStep")) return BenefitsStep;
    if (name.endsWith("SignatureStep")) return SignatureStep;
    if (name.endsWith("CobraCoveredPeopleStep")) return CobraCoveredPeopleStep;
    if (name.endsWith("LifeEventDependentsStep")) return LifeEventDependentsStep;
    return () => null;
  } } };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const request = vi.mocked(apiRequest);
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
const benefit = (id: string) => ({
  benefitId: id, benefitName: id, benefitTypeId: "medical", benefitTypeName: "Medical",
  benefitTypeSequence: 1, benefitTypeOnlyOne: true, eligible: true, reasons: [],
});
const savedSignature = { type: "typed", value: "Saved Name", signedAt: "2026-01-01T00:00:00Z" };
const dateStep: WizardStepManifest = {
  id: "effective_date", name: "Effective Date", kind: "form", state: "completed", submitOnNext: true,
  schema: { type: "object", properties: {
    startYmd: { type: "string", format: "date", title: "Effective date", default: "2026-11-01" },
  }, required: ["startYmd"] },
};
const custom = (id: string, component: string): WizardStepManifest => ({
  id, component, name: id, kind: "custom", state: "completed", submitOnNext: true,
});
const ordinary: WizardStepManifest = { id: "ordinary", name: "Ordinary", kind: "form",
  state: "pending", schema: { type: "object", properties: { name: { type: "string" } } } };
function manifest(step: WizardStepManifest): WizardManifest {
  return { wizardType: "enrollment", displayName: "Enrollment", description: "", isReport: false,
    currentStep: step.id, steps: [
      { id: "before", name: "Before", kind: "custom", state: "completed" }, step,
      { id: "review", name: "Review", kind: "review", state: "pending" },
    ] };
}
function deferred() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>(done => { resolve = done; });
  return { promise, resolve };
}

describe("enrollment Next submits the live draft before navigation", () => {
  let container: HTMLDivElement;
  let root: Root;
  const button = (id: string) => container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)!;
  const next = () => button("button-next-step");
  const click = async (element: HTMLElement) => act(async () => { element.click(); });
  async function input(selector: string, value: string) {
    const element = container.querySelector<HTMLInputElement>(selector)!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function render(step: WizardStepManifest, data: any = {}, wizardId = "wizard-1", wizardType = "enrollment") {
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}>
        <FrameworkWizardBody wizardId={wizardId} wizardType={wizardType} manifest={manifest(step)} data={data} />
      </QueryClientProvider>);
    });
  }
  beforeEach(() => {
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
    queryClient.clear();
    vi.clearAllMocks();
    request.mockResolvedValue(new Response("{}"));
    vi.spyOn(queryClient, "invalidateQueries").mockResolvedValue();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue("data:image/png;base64,ZHJhd24=");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient.setQueryData(["/api/wizards/wizard-1/dispatch/benefits/data"], {
      records: [benefit("medical-a"), benefit("medical-b")], currentlyElectedBenefitIds: ["medical-a"],
    });
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (scrollIntoViewDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
    else delete (Element.prototype as any).scrollIntoView;
  });

  it("ignores old completion when Benefits is cleared, preserves markers, and enforces choose-one", async () => {
    await render(custom("benefits", "BenefitsStep"), { policyId: "p", benefitIds: ["medical-a"] });
    expect(next().disabled).toBe(false);
    expect(container.textContent).toContain("Currently elected");
    expect(container.textContent).not.toContain("Save Selection");
    await click(button("checkbox-benefit-medical-a"));
    expect(next().disabled).toBe(true);
    await click(button("checkbox-benefit-medical-a"));
    await click(button("checkbox-benefit-medical-b"));
    await click(next());
    expect(request.mock.calls[0][2]).toEqual({ input: { benefitIds: ["medical-b"] } });
    expect(request.mock.calls[1][1]).toContain("/navigate");
    expect(request.mock.calls[1][2]).toEqual({ direction: "next", expectedStep: "benefits" });
  });

  it("locks both directions and inputs until persistence finishes, rejecting duplicate clicks", async () => {
    const save = deferred();
    request.mockReturnValueOnce(save.promise);
    await render(custom("benefits", "BenefitsStep"), { policyId: "p", benefitIds: ["medical-a"] });
    await act(async () => { next().click(); next().click(); button("button-previous-step").click(); });
    expect(request).toHaveBeenCalledTimes(1);
    expect(next().disabled).toBe(true);
    expect(button("button-previous-step").disabled).toBe(true);
    expect(button("checkbox-benefit-medical-a").disabled).toBe(true);
    await act(async () => { save.resolve(new Response("{}")); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(["save", "navigation"])("retains Benefits draft on %s failure and permits retry", async failure => {
    await render(custom("benefits", "BenefitsStep"), { policyId: "p", benefitIds: ["medical-a"] });
    await click(button("checkbox-benefit-medical-b"));
    if (failure === "navigation") request.mockResolvedValueOnce(new Response("{}"));
    request.mockRejectedValueOnce(new Error("Connection refused"));
    await click(next());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("try Next again");
    expect(button("checkbox-benefit-medical-b").getAttribute("aria-checked")).toBe("true");
    expect(request).toHaveBeenCalledTimes(failure === "save" ? 1 : 2);
    await click(next());
    expect(request.mock.calls.at(-2)?.[2]).toEqual({ input: { benefitIds: ["medical-b"] } });
  });

  it("disables Next for stale or conflicting saved benefit selections", async () => {
    await render(custom("benefits", "BenefitsStep"), { policyId: "p", benefitIds: ["removed"] });
    expect(next().disabled).toBe(true);
    await render(custom("benefits", "BenefitsStep"), { policyId: "p", benefitIds: ["medical-a", "medical-b"] }, "wizard-2");
    queryClient.setQueryData(["/api/wizards/wizard-2/dispatch/benefits/data"], { records: [benefit("medical-a"), benefit("medical-b")] });
    expect(next().disabled).toBe(true);
  });

  it("hydrates saved dates, validates live edits after completion, and submits the displayed date", async () => {
    await render(dateStep, { startYmd: "2026-12-01" });
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe("2026-12-01");
    expect(container.textContent).not.toContain("Save");
    await input('input[type="date"]', "");
    expect(next().disabled).toBe(true);
    await input('input[type="date"]', "2027-02-01");
    expect(next().disabled).toBe(false);
    await click(next());
    expect(request.mock.calls[0][2]).toEqual({ input: { startYmd: "2027-02-01" } });
  });

  it("hydrates and saves generic opted-in schema choices through Next", async () => {
    const cobraCoverage: WizardStepManifest = {
      id: "coverage", name: "Coverage", kind: "form", state: "completed", submitOnNext: true,
      schema: { type: "object", properties: {
        coverageChoice: { type: "string", oneOf: [{ const: "medical", title: "Medical only" }] },
      }, required: ["coverageChoice"] },
    };
    await render(cobraCoverage, {}, "cobra-empty-choice", "bao_cobra_enrollment");
    expect(next().disabled).toBe(true);
    await render(cobraCoverage, { coverageChoice: "medical" }, "cobra-wizard", "bao_cobra_enrollment");
    expect(next().disabled).toBe(false);
    expect(container.textContent).toContain("Medical only");
    expect(container.textContent).not.toContain("Save");
    await click(next());
    expect(request.mock.calls[0][1]).toContain("/coverage/submit");
    expect(request.mock.calls[0][2]).toEqual({ input: { coverageChoice: "medical" } });
    expect(request.mock.calls[1][1]).toContain("/navigate");
    request.mockClear();

    const eventType: WizardStepManifest = {
      id: "event_type", name: "Life Event", kind: "form", state: "completed", submitOnNext: true,
      schema: { type: "object", properties: {
        eventType: { type: "string", oneOf: [
          { const: "birth", title: "Birth" }, { const: "marriage", title: "Marriage" },
          { const: "divorce", title: "Divorce" }, { const: "death", title: "Death" },
        ] },
      }, required: ["eventType"] },
    };
    await render(eventType, { eventType: "divorce" }, "life-event-wizard", "life_event_enrollment");
    expect(next().disabled).toBe(false);
    expect(container.textContent).toContain("Divorce");
    await click(next());
    expect(request.mock.calls[0][1]).toContain("/event_type/submit");
    expect(request.mock.calls[0][2]).toEqual({ input: { eventType: "divorce" } });
  });

  it("saves COBRA covered people through Next and does not trust missing data as an empty list", async () => {
    const step = custom("covered_people", "bao_cobra_enrollment:CobraCoveredPeopleStep");
    await render(step, {
      workerName: "Fictional Subscriber", isSubscriberCase: true, selectedRelationIds: [],
    }, "cobra-missing-people", "bao_cobra_enrollment");
    expect(next().disabled).toBe(true);
    queryClient.setQueryData(["/api/wizards/cobra-people/dispatch/covered_people/data"], {
      records: [{ relationId: "relation-1", name: "Fictional Dependent", relationTypeName: "Spouse" }],
      pricing: { coveredLives: 1, tier: "1", lines: [], monthlyTotal: null },
    });
    await render(step, {
      workerName: "Fictional Subscriber", isSubscriberCase: true, selectedRelationIds: [],
    }, "cobra-people", "bao_cobra_enrollment");
    expect(next().disabled).toBe(false);
    await click(button("checkbox-dependent-relation-1"));
    expect(container.querySelector('[data-testid="text-pending-covered-people-price"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="button-save-covered-people"]')).toBeNull();
    await click(next());
    expect(request.mock.calls[0][1]).toContain("/covered_people/submit");
    expect(request.mock.calls[0][2]).toEqual({ input: { relationIds: ["relation-1"] } });
    expect(request.mock.calls[1][1]).toContain("/navigate");
  });

  it("validates gender specification and persists Life Event gender drafts on Next", async () => {
    const step = custom("dependents", "life_event_enrollment:LifeEventDependentsStep");
    queryClient.setQueryData(["/api/wizards/gender-wizard/dispatch/dependents/data"], {
      currentRelationships: [
        { relationId: "relation-1", label: "Fictional One", genderCalc: "Current" },
        { relationId: "relation-2", label: "Fictional Two", genderCalc: "Current" },
      ],
    });
    queryClient.setQueryData(["/api/options/gender"], [
      { id: "gender-female", name: "Female", nota: false, sequence: 1 },
      { id: "gender-nota", name: "Specify Gender", nota: true, sequence: 2 },
    ]);
    await render(step, {
      eventAction: "remove",
      removedRelationshipIds: ["relation-1"],
    }, "gender-wizard", "life_event_enrollment");
    expect(next().disabled).toBe(false);
    expect(container.querySelector('[data-testid="button-save-dependent-gender-relation-1"]')).toBeNull();

    const firstGender = container.querySelector<HTMLButtonElement>('[data-testid="select-dependent-gender"]')!;
    await click(firstGender);
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
      .find(node => node.textContent === "Specify Gender")!;
    await click(option);
    expect(next().disabled).toBe(true);
    await input('[data-testid="input-dependent-gender-nota"]', "Nonbinary");
    expect(next().disabled).toBe(false);
    await click(next());
    expect(request.mock.calls.slice(0, 3).map(call => call[2])).toEqual([
      { input: { action: "setCurrentGender", relationId: "relation-1", gender: "gender-nota", genderNota: "Nonbinary" } },
      { input: { action: "continue" } },
      { direction: "next", expectedStep: "dependents" },
    ]);
  });

  it("reports partial Life Event gender saves and retries only edits not confirmed", async () => {
    const step = custom("dependents", "life_event_enrollment:LifeEventDependentsStep");
    queryClient.setQueryData(["/api/wizards/partial-gender/dispatch/dependents/data"], {
      currentRelationships: [
        { relationId: "relation-1", label: "Fictional One", genderCalc: "Current" },
        { relationId: "relation-2", label: "Fictional Two", genderCalc: "Current" },
      ],
    });
    queryClient.setQueryData(["/api/options/gender"], [
      { id: "gender-female", name: "Female", nota: false, sequence: 1 },
    ]);
    await render(step, {
      eventAction: "remove",
      removedRelationshipIds: ["relation-1"],
    }, "partial-gender", "life_event_enrollment");
    const chooseGender = async (relationId: string) => {
      const row = container.querySelector(`[data-testid="row-current-dependent-${relationId}"]`)!;
      await click(row.querySelector('[data-testid="select-dependent-gender"]')!);
      const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
        .find(node => node.textContent === "Female")!;
      await click(option);
    };
    await chooseGender("relation-1");
    await chooseGender("relation-2");
    request.mockResolvedValueOnce(new Response("{}"));
    request.mockRejectedValueOnce(new Error("Second contact update failed"));
    await click(next());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Saved 1 of 2 gender changes");
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][2]).toMatchObject({
      input: { action: "setCurrentGender", relationId: "relation-1", gender: "gender-female" },
    });
    expect(request.mock.calls[1][2]).toMatchObject({
      input: { action: "setCurrentGender", relationId: "relation-2", gender: "gender-female" },
    });
    expect(request.mock.calls.some(call => String(call[1]).includes("/navigate"))).toBe(false);

    await click(next());
    expect(request.mock.calls.slice(2).map(call => call[2])).toEqual([
      { input: { action: "setCurrentGender", relationId: "relation-2", gender: "gender-female", genderNota: "" } },
      { input: { action: "continue" } },
      { direction: "next", expectedStep: "dependents" },
    ]);
  });

  it("can use the default immediately and keeps Open Enrollment's fixed date read-only", async () => {
    await render(dateStep);
    expect(next().disabled).toBe(false);
    const fixed = { ...dateStep, schema: { ...dateStep.schema, properties: {
      startYmd: { ...dateStep.schema.properties.startYmd, default: "2027-01-01", readOnly: true },
    } } };
    await render(fixed, { forcedStartYmd: "2027-01-01" }, "fixed-wizard");
    const date = container.querySelector<HTMLInputElement>('input[type="date"]')!;
    expect(date.value).toBe("2027-01-01");
    expect(date.readOnly || date.disabled).toBe(true);
    expect(next().disabled).toBe(false);
    await click(next());
    expect(request.mock.calls[0][2]).toEqual({ input: { startYmd: "2027-01-01" } });
  });

  it("retains an edited date on server refusal and blocks duplicate actions during its retry", async () => {
    await render(dateStep, { startYmd: "2026-12-01" });
    await input('input[type="date"]', "2027-02-01");
    request.mockRejectedValueOnce(new Error("Only administrators can override the computed effective date"));
    await click(next());
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe("2027-02-01");
    expect(container.textContent).toContain("Only administrators");
    const save = deferred();
    request.mockReturnValueOnce(save.promise);
    await click(next());
    expect(next().disabled).toBe(true);
    expect(button("button-previous-step").disabled).toBe(true);
    await act(async () => save.resolve(new Response("{}")));
    expect(request.mock.calls.at(-1)?.[1]).toContain("/navigate");
  });

  it("keeps an invalid/failed typed replacement from using a captured signature", async () => {
    await render(custom("signature", "SignatureStep"), { signature: savedSignature });
    expect(next().disabled).toBe(false);
    await input("#typed-signature", "New Name");
    expect(container.querySelector('[data-testid="alert-signature-captured"]')).toBeNull();
    await input("#typed-signature", "   ");
    expect(next().disabled).toBe(true);
    await input("#typed-signature", "New Name");
    request.mockRejectedValueOnce(new Error("Save refused"));
    await click(next());
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLInputElement>("#typed-signature")!.value).toBe("New Name");
    await click(next());
    expect(request.mock.calls.at(-2)?.[2]).toEqual({ input: { signature: { type: "typed", value: "New Name" } } });
    expect(container.textContent).not.toContain("Save Signature");
  });

  it("allows unchanged captured signatures without a redundant submit", async () => {
    await render(custom("signature", "SignatureStep"), { signature: savedSignature });
    await click(next());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toContain("/navigate");
  });

  it("requires a drawn replacement after switching mode or Clear and submits its image", async () => {
    await render(custom("signature", "SignatureStep"), { signature: savedSignature });
    await click(button("button-signature-mode-drawn"));
    expect(next().disabled).toBe(true);
    const canvas = container.querySelector("canvas")!;
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: 10, clientY: 10 }));
      canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 20, clientY: 20 }));
      canvas.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
    expect(next().disabled).toBe(false);
    await click(button("button-clear-signature"));
    expect(next().disabled).toBe(true);
    await act(async () => {
      canvas.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      canvas.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    });
    await click(next());
    expect(request.mock.calls[0][2]).toEqual({ input: { signature: { type: "drawn", value: "data:image/png;base64,ZHJhd24=" } } });
  });

  it("uploads only with Next, keeps the failed file, blocks navigation while uploading, and retries", async () => {
    const upload = deferred();
    const fetch = vi.fn().mockReturnValueOnce(upload.promise).mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await render(custom("signature", "SignatureStep"), { signature: savedSignature });
    await click(button("button-signature-mode-upload"));
    expect(next().disabled).toBe(true);
    const file = new File(["signature"], "signature.png", { type: "image/png" });
    const element = container.querySelector<HTMLInputElement>("#signature-file")!;
    await act(async () => {
      Object.defineProperty(element, "files", { value: [file] });
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(fetch).not.toHaveBeenCalled();
    await click(next());
    expect(next().disabled).toBe(true);
    expect(button("button-previous-step").disabled).toBe(true);
    expect(request).not.toHaveBeenCalled();
    await act(async () => upload.resolve(new Response('{"message":"Unsupported file type"}', { status: 400 })));
    expect(container.textContent).toContain("Unsupported file type");
    expect(element.files![0]).toBe(file);
    expect(request).not.toHaveBeenCalled();
    await click(next());
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch.mock.calls[1][1].body as FormData).get("file")).toBe(file);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("clears registrations and drafts on step/record changes; unrelated Save and completion gates remain", async () => {
    await render(custom("signature", "SignatureStep"));
    await input("#typed-signature", "Draft Name");
    expect(next().disabled).toBe(false);
    await render(ordinary);
    expect(next().disabled).toBe(true);
    expect(button("button-save-inputs")).toBeTruthy();
    await render({ ...ordinary, state: "completed" });
    await click(next());
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toContain("/navigate");
    expect(request.mock.calls[0][2]).toEqual({ direction: "next" });
    await render(custom("signature", "SignatureStep"), {}, "another-wizard");
    expect(next().disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>("#typed-signature")!.value).toBe("");
  });
});
