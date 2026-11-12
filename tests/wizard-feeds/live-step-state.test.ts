import { describe, expect, it } from "vitest";
import type { Wizard } from "../../shared/schema";
import type { WizardPlugin } from "../../server/plugins/wizards/types";
import { WizardPluginRegistry } from "../../server/plugins/wizards/registry";

const wizard = { id: "upload", currentStep: "benefits", data: {} } as Wizard;
describe("live wizard step readiness", () => {
  it("awaits live state in the manifest and navigation's shared resolver", async () => {
    let active = true;
    const registry = new WizardPluginRegistry();
    const plugin: WizardPlugin = {
      id: "test-feed", name: "Test Feed", description: "Test",
      steps: [{ id: "benefits", name: "Benefits", kind: "custom", getState: async () => {
        await Promise.resolve();
        return active ? "completed" : "pending";
      } }],
    };
    expect((await registry.computeManifest(plugin, wizard)).steps[0].state).toBe("completed");
    active = false;
    expect(await registry.stepState(plugin, plugin.steps[0], wizard)).toBe("pending");
    expect((await registry.computeManifest(plugin, wizard)).steps[0].state).toBe("pending");
  });
  it("preserves synchronous and default states for unrelated wizard types", async () => {
    const registry = new WizardPluginRegistry();
    const plugin: WizardPlugin = {
      id: "other-feed", name: "Other", description: "Test",
      steps: [
        { id: "upload", name: "Upload", kind: "upload", getState: () => "completed" },
        { id: "benefits", name: "Benefits", kind: "custom" },
      ],
    };
    const manifest = await registry.computeManifest(plugin, wizard);
    expect(manifest.steps.map(step => step.state)).toEqual(["completed", "in_progress"]);
    expect(JSON.stringify(manifest)).not.toContain("Promise");
  });
});
