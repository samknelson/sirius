// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeliverStep } from "../../client/src/plugins/wizards/trust_provider_edi/DeliverStep";
import { queryClient } from "../../client/src/lib/queryClient";

const toast = vi.hoisted(() => vi.fn());
vi.mock("../../client/src/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("Deliver download choice", () => {
  let root: Root;
  let container: HTMLDivElement;
  let data: any;
  let failExport: boolean;
  let failData: boolean;
  let fetcher: ReturnType<typeof vi.fn>;
  let click: ReturnType<typeof vi.spyOn>;
  let holdExport: (() => Promise<Response>) | undefined;
  const render = (wizardId = "saved") => root.render(
    <QueryClientProvider client={queryClient}>
      <DeliverStep wizardId={wizardId} wizardType="trust_provider_edi" step={{ id: "deliver" } as any} />
    </QueryClientProvider>,
  );
  const flush = async () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  const button = () => container.querySelector<HTMLButtonElement>('[data-testid="button-download"]')!;
  const chooseQa = async () => act(async () => {
    const select = container.querySelector("select")!;
    select.value = "carrier-csv";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  beforeEach(() => {
    queryClient.clear();
    toast.mockClear();
    failExport = false; failData = false; holdExport = undefined;
    data = { ready: true, rowCount: 1, filename: "NATIVE.txt", destinationId: "destination", destinationName: "Fixture", delivery: { deliveredAt: "2026-10-01", filename: "NATIVE.txt", rowCount: 1 } };
    fetcher = vi.fn(async (url: string) => {
      if (url.includes("/export?")) {
        if (holdExport) return holdExport();
        if (failExport) return new Response(JSON.stringify({ message: "Export failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
        const qa = url.endsWith("carrier-csv");
        return new Response(qa ? "QA-only,data" : "NATIVE", { headers: {
          "Content-Type": qa ? "text/csv" : "text/plain",
          "Content-Disposition": `attachment; filename*=UTF-8''${qa ? "NATIVE-carrier-layout-qa.csv" : "NATIVE.txt"}`,
        } });
      }
      if (failData) return new Response("unavailable", { status: 503 });
      return new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:fixture"), revokeObjectURL: vi.fn() }));
    click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("defaults to Provider file and downloads each selection with its server filename", async () => {
    await act(async () => render());
    await flush();
    expect(container.querySelector("select")?.value).toBe("provider");
    expect(container.textContent).toContain("Re-deliver");
    await act(async () => button().click());
    await flush();
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe("NATIVE.txt");
    await chooseQa();
    await act(async () => button().click());
    await flush();
    expect((click.mock.instances[1] as HTMLAnchorElement).download).toBe("NATIVE-carrier-layout-qa.csv");
    const exports = fetcher.mock.calls.filter(([url]) => String(url).includes("/export?"));
    expect(exports.map(([url]) => url)).toEqual([
      "/api/wizards/saved/dispatch/deliver/export?format=provider",
      "/api/wizards/saved/dispatch/deliver/export?format=carrier-csv",
    ]);
    expect(fetcher.mock.calls.every(([, options]) => !(options as any)?.method)).toBe(true);
  });
  it("shows export failure and never downloads stale native content after QA fails", async () => {
    await act(async () => render()); await flush();
    await act(async () => button().click()); await flush();
    await chooseQa(); failExport = true;
    await act(async () => button().click()); await flush();
    expect(click).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Export failed");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Download failed" }));
  });
  it("keeps SFTP submission native-only after selecting QA", async () => {
    await act(async () => render()); await flush();
    await chooseQa();
    await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="button-deliver"]')!.click());
    await flush();
    const submission = fetcher.mock.calls.find(([url]) => String(url).endsWith("/submit"));
    expect(submission?.[1]).toMatchObject({ method: "POST", body: JSON.stringify({ input: {} }) });
    expect(click).not.toHaveBeenCalled();
  });
  it("handles loading, missing generation, no SFTP destination and empty saved output", async () => {
    data = { ready: false };
    await act(async () => render()); await flush();
    expect(container.textContent).toContain("Generate the file");
    expect(button()).toBeNull();
    data = { ready: true, rowCount: 0, filename: "EMPTY.txt" };
    await act(async () => queryClient.invalidateQueries()); await flush();
    expect(container.textContent).toContain("No detail records matched");
    expect(container.textContent).toContain("download only");
    await act(async () => button().click()); await flush();
    expect(click).toHaveBeenCalledTimes(1);
  });
  it("disables the choice while preparing and discards a response after changing wizard", async () => {
    await act(async () => render()); await flush();
    let release!: (response: Response) => void;
    holdExport = () => new Promise(resolve => { release = resolve; });
    await act(async () => button().click()); await flush();
    expect(button().disabled).toBe(true);
    expect(container.querySelector("select")?.disabled).toBe(true);
    await act(async () => render("other")); await flush();
    await act(async () => release(new Response("old", { headers: { "Content-Disposition": "attachment; filename=\"old.txt\"" } })));
    await flush();
    expect(click).not.toHaveBeenCalled();
    expect(container.querySelector("select")?.value).toBe("provider");
  });
  it("shows data read failure instead of claiming generation is missing", async () => {
    failData = true;
    await act(async () => render()); await flush();
    expect(container.textContent).toContain("Could not load delivery information");
    expect(container.textContent).not.toContain("Generate the file");
  });
});
