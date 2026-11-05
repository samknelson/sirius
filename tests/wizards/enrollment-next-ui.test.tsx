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
  return { wizardComponentRegistry: { resolve: (name: string) => name === "BenefitsStep" ? BenefitsStep : SignatureStep } };
});

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const request = vi.mocked(apiRequest);
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
  async function render(step: WizardStepManifest, data: any = {}, wizardId = "wizard-1") {
    await act(async () => {
      root.render(<QueryClientProvider client={queryClient}>
        <FrameworkWizardBody wizardId={wizardId} wizardType="enrollment" manifest={manifest(step)} data={data} />
      </QueryClientProvider>);
    });
  }
  beforeEach(() => {
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
