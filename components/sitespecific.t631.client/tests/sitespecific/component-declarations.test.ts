import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ lookup: vi.fn(() => { throw new Error("fixture connection lookup"); }) }));
vi.mock("../../../../server/storage", () => ({
  storage: { pluginConfigs: { getByKindAndPlugin: fixture.lookup } },
}));
import { getWcVendorOperationManifest, getWcVendorPlugin } from "../../../../server/plugins/wc-vendors/registry";
import { floodPluginRegistry } from "../../../../server/plugins/system/flood/registry";
import { MaintenanceModeError, setMaintenanceActive } from "../../../../server/services/maintenance-flag";
import { wcRequest } from "../../../../server/services/webclient";
import { T631_PLUGIN_ID } from "../../server/plugins/wc-vendors/plugins/sitespecific-t631";
import "../../server/plugins/system/flood/plugins/t631-arrival";
import { componentDocumentPolicy } from "../../../../server/services/component/document-policy";

afterEach(() => { setMaintenanceActive(false); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe("component-owned declarations", () => {
  it("sets arrival privacy before parsing without changing unrelated documents", () => {
    const setHeader = vi.fn(), next = vi.fn();
    const apply = (path: string) => componentDocumentPolicy(
      { path } as Parameters<typeof componentDocumentPolicy>[0],
      { setHeader } as unknown as Parameters<typeof componentDocumentPolicy>[1],
      next,
    );
    apply("/sitespecific/t631/arrive");
    expect(setHeader).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
    expect(setHeader).toHaveBeenCalledWith("Cache-Control", "private, no-store");
    expect(next).toHaveBeenCalledOnce();
    setHeader.mockClear();
    apply("/workers");
    expect(setHeader).not.toHaveBeenCalled();
  });
  it("preserves the manual ping contract and credential guidance", () => {
    const plugin = getWcVendorPlugin(T631_PLUGIN_ID)!;
    expect(getWcVendorOperationManifest(plugin)).toContainEqual({
      id: "sitespecific.t631.service.ping", description: "ping the T631 service",
      needsWritableDatabase: false, externalSideEffect: true, cacheMode: "uncached",
      manualRun: { argsSchema: { type: "object", properties: {}, additionalProperties: false }, effect: "read" },
    });
    expect(plugin.credential).toEqual({
      secretName: "required",
      setupGuidance: "Enter the environment-secret name here, not a token or JSON value. The value stored in that secret must be a JSON object containing both T631 tokens:",
      setupExample: '{"accessToken":"<access-token>","employerToken":"<employer-token>"}',
    });
  });
  it("preserves arrival flood IDs, singleton defaults and component gates", () => {
    for (const id of ["t631-arrival-worker", "t631-arrival-ip"]) {
      expect(floodPluginRegistry.get(id)).toMatchObject({
        singleton: true, requiredComponent: "sitespecific.t631.client",
      });
    }
    expect(floodPluginRegistry.get("t631-arrival-worker")!.defaults).toEqual({ threshold: 5, windowSeconds: 60 });
    expect(floodPluginRegistry.get("t631-arrival-ip")!.defaults).toEqual({ threshold: 5, windowSeconds: 60 });
  });
  it("refuses maintenance ping before connection lookup or network activity", async () => {
    const fetch = vi.fn(() => { throw new Error("No network permitted"); });
    vi.stubGlobal("fetch", fetch);
    fixture.lookup.mockClear();
    const ping = () => wcRequest({
      vendor: { pluginId: T631_PLUGIN_ID }, operation: "sitespecific.t631.service.ping", args: undefined,
    });
    setMaintenanceActive(true);
    await expect(ping()).rejects.toBeInstanceOf(MaintenanceModeError);
    expect(fixture.lookup).not.toHaveBeenCalled();
    setMaintenanceActive(false);
    await expect(ping()).rejects.toThrow("fixture connection lookup");
    expect(fixture.lookup).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
