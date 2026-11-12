import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type OneoffInputRendererProps = {
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
};

/**
 * Typed inputs are deliberately opt-in by plugin and action. All other plugin
 * operations use the generic JSON input editor.
 */
export const oneoffInputRenderers: Record<
  string,
  Record<string, (props: OneoffInputRendererProps) => JSX.Element>
> = {
  "oneoff-test": {
    "run-batch": ({ value, onChange }) => (
      <div className="grid gap-4 rounded-xl border border-[#dce5e0] bg-[#f6f8f6] p-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="batch-count">Batch count</Label>
          <Input
            id="batch-count"
            type="number"
            min={1}
            max={1000}
            step={1}
            value={String(value.count ?? 300)}
            onChange={(event) => onChange({ ...value, count: event.target.value })}
            aria-describedby="batch-count-help"
          />
          <p id="batch-count-help" className="text-xs text-muted-foreground">Choose 1–1,000 items.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="batch-delay">Delay between items (ms)</Label>
          <Input
            id="batch-delay"
            type="number"
            min={1}
            max={60000}
            step={1}
            value={String(value.delayMs ?? 1000)}
            onChange={(event) => onChange({ ...value, delayMs: event.target.value })}
            aria-describedby="batch-delay-help"
          />
          <p id="batch-delay-help" className="text-xs text-muted-foreground">Choose 1–60,000 ms.</p>
        </div>
        <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
          This batch is submitted as background work. Defaults: 300 items with a 1,000 ms delay.
        </p>
      </div>
    ),
  },
};