import type { WizardManifest } from "@/components/wizards/framework/types";

/** Server-resolved saved values only; never infer new defaults in the browser. */
export function PolicySummary({ data, manifest }: { data: any; manifest: WizardManifest }) {
  const saved = manifest.steps.find(s => s.id === "params")?.formData;
  if (!saved || saved.explicitSubscriberTerminations === undefined) return null;
  const generated = data?.reportMeta?.terminationPolicy;
  const policy = generated ?? {
    subscribers: saved.explicitSubscriberTerminations,
    dependents: saved.explicitDependentTerminations,
    months: saved.terminationLookbackMonths,
  };
  return <aside className="mb-4 rounded-md border p-4 space-y-2" aria-label="Saved termination policy">
    <p className="font-medium">{generated ? "Completed generation policy" : "Saved run policy"}</p>
    <p>Subscriber terminations: {policy.subscribers ? "On" : "Off"} · Dependent terminations: {policy.dependents ? "On" : "Off"} · Lookback: {String(policy.months)} completed calendar month(s)</p>
    {!data?.terminationPolicy && <p className="text-sm text-muted-foreground">Legacy run: these values come from the saved configuration snapshot, with missing flags off. Saving Parameters makes them run-owned; new-run defaults do not apply.</p>}
    {data?.previousGeneration?.error && <p className="text-sm text-muted-foreground">
      Historical failure before the latest settings save: {data.previousGeneration.error}. This does not validate the current choices.
    </p>}
    <p className="text-sm text-muted-foreground">Unsaved edits do not affect generation. Save Parameters, then regenerate before using Results or Deliver.</p>
  </aside>;
}
