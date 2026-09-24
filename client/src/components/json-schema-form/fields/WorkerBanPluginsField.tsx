import { useQuery } from "@tanstack/react-query";
import type { FieldProps } from "@rjsf/utils";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

interface WorkerBanPluginEntry {
  id: string;
  name: string;
  description?: string;
  componentEnabled: boolean;
  actionNames: string[];
}

/**
 * RJSF field for selecting the worker-ban behaviors (plugins) a ban type
 * applies. Triggered by the vendor key `x-widget: "worker-ban-plugins"` on
 * an array-of-string property. The value is the list of selected plugin
 * ids; the list is fetched from the worker-ban plugin manifest, so only
 * registered, component-enabled behaviors are offered.
 */
export function WorkerBanPluginsField(props: FieldProps) {
  const { formData, onChange, disabled, readonly, fieldPathId } = props;
  const selected: string[] = Array.isArray(formData)
    ? (formData as string[])
    : [];
  const isDisabled = Boolean(disabled || readonly);

  const { data: plugins = [], isLoading } = useQuery<WorkerBanPluginEntry[]>({
    queryKey: ["/api/plugins/worker-ban/manifest"],
  });

  const available = plugins.filter(
    (p) => p.componentEnabled || selected.includes(p.id),
  );

  const toggle = (pluginId: string, checked: boolean) => {
    const next = checked
      ? Array.from(new Set([...selected, pluginId]))
      : selected.filter((id) => id !== pluginId);
    onChange(next, fieldPathId.path);
  };

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="worker-ban-plugins-loading">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-32" />
          </div>
        ))}
      </div>
    );
  }

  if (available.length === 0) {
    return (
      <div
        className="text-muted-foreground text-sm"
        data-testid="worker-ban-plugins-empty"
      >
        No ban behaviors available.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="worker-ban-plugins">
      {available.map((plugin) => {
        const checked = selected.includes(plugin.id);
        return (
          <div
            key={plugin.id}
            className="flex items-start gap-3 p-2 rounded-md border bg-background"
            data-testid={`worker-ban-plugin-${plugin.id}`}
          >
            <Checkbox
              id={`worker-ban-plugin-${plugin.id}`}
              checked={checked}
              onCheckedChange={(c) => toggle(plugin.id, !!c)}
              disabled={isDisabled}
              className="mt-0.5"
              data-testid={`checkbox-worker-ban-plugin-${plugin.id}`}
            />
            <Label
              htmlFor={`worker-ban-plugin-${plugin.id}`}
              className="flex-1 space-y-1 font-normal cursor-pointer"
            >
              <span className="flex items-center gap-2 font-medium">
                {plugin.name}
                {!plugin.componentEnabled && (
                  <Badge variant="secondary">Component disabled</Badge>
                )}
              </span>
              {plugin.description && (
                <span className="block text-xs text-muted-foreground">
                  {plugin.description}
                </span>
              )}
              {plugin.actionNames.length > 0 && (
                <span className="block text-xs text-muted-foreground">
                  Prohibits: {plugin.actionNames.join(", ")}
                </span>
              )}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
