import { useEffect, useRef, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  pluginManifestQueryKey,
  pluginConfigsQueryKey,
  pluginConfigsUrl,
  pluginConfigsMetaQueryKey,
  type ArrayManifestPluginKind,
  type PluginConfigEnvelopeField,
} from "@/plugins/_core";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2, Plus, Settings, Trash2, ChevronDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { JsonSchema } from "@shared/json-schema-form";
import type { IChangeEvent } from "@rjsf/core";
import { SchemaForm, sortArrayTableSettings } from "@/components/json-schema-form";

/**
 * Generic, kind-aware plugin-config admin page (Task #353 — additive
 * foundation). It is driven entirely by the unified manifest +
 * plugin_configs endpoints (`/api/plugins/:kind/manifest` and
 * `/api/plugins/:kind/configs`) and the per-kind config adapter on the
 * server. No kind-specific code lives here.
 *
 * This page is intentionally NOT wired into any sidebar / navigation
 * registry — it is reachable only via a hidden route and is not used by
 * any real workflow yet. It exists to prove the generic CRUD surface and
 * to serve as the foundation a future cutover task will adopt. The
 * existing per-kind admin pages (e.g. Charge Plugins) remain the source
 * of truth until then.
 */

// Kinds the unified generic config routes actually serve. `charge` is
// intentionally excluded: it is still legacy-owned (see LEGACY_OWNED_KINDS in
// server/modules/plugins-config.ts), so its generic routes 404. The remaining
// kinds exercise the full surface — `trust-eligibility` / `dispatch-eligibility`
// have relational envelope fields, `dashboard` has none.
const ALLOWED_KINDS: ArrayManifestPluginKind[] = [
  "dashboard",
  "dispatch-eligibility",
  "trust-eligibility",
];

interface ManifestEntry {
  id: string;
  name: string;
  description?: string;
  configSchema?: JsonSchema;
}

interface PluginConfigRow {
  id: string;
  pluginType: string;
  pluginId: string;
  name: string | null;
  enabled: boolean;
  ordering: number;
  data: unknown;
  [key: string]: unknown;
}

const BASE_KEYS = new Set([
  "id",
  "pluginType",
  "pluginId",
  "name",
  "enabled",
  "ordering",
  "data",
  "createdAt",
  "updatedAt",
]);

export default function GenericPluginConfigsPage() {
  const params = useParams<{ kind: string }>();
  const kind = params.kind as ArrayManifestPluginKind;
  const isValidKind = ALLOWED_KINDS.includes(kind);

  usePageTitle(`Plugin Configs — ${kind}`);
  const { toast } = useToast();

  const [dialogPlugin, setDialogPlugin] = useState<ManifestEntry | null>(null);
  const [dialogConfig, setDialogConfig] = useState<PluginConfigRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data: plugins = [], isLoading: isLoadingPlugins } = useQuery<ManifestEntry[]>({
    queryKey: pluginManifestQueryKey(kind),
    enabled: isValidKind,
  });

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<PluginConfigRow[]>({
    queryKey: pluginConfigsQueryKey(kind),
    enabled: isValidKind,
  });

  const { data: meta } = useQuery<{ envelopeFields: PluginConfigEnvelopeField[] }>({
    queryKey: pluginConfigsMetaQueryKey(kind),
    enabled: isValidKind,
  });
  const envelopeFields = meta?.envelopeFields ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `${pluginConfigsUrl(kind)}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginConfigsQueryKey(kind) });
      toast({ title: "Success", description: "Configuration deleted." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to delete configuration.",
        variant: "destructive",
      });
    },
  });

  if (!isValidKind) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground" data-testid="text-invalid-kind">
              Unknown plugin kind: <strong>{kind}</strong>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoadingPlugins || isLoadingConfigs) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  const openNew = (plugin: ManifestEntry) => {
    setDialogPlugin(plugin);
    setDialogConfig(null);
    setDialogOpen(true);
  };

  const openEdit = (plugin: ManifestEntry, config: PluginConfigRow) => {
    setDialogPlugin(plugin);
    setDialogConfig(config);
    setDialogOpen(true);
  };

  const sortedPlugins = [...plugins].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
            Plugin Configs — {kind}
          </h1>
          <p className="text-muted-foreground mt-2">
            Generic, adapter-driven configuration manager for the{" "}
            <strong>{kind}</strong> plugin kind. Backed by the unified
            plugin_configs storage.
          </p>
        </div>
        {sortedPlugins.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button data-testid="button-new-config">
                <Plus className="mr-2 h-4 w-4" />
                New Configuration
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {sortedPlugins.map((plugin) => (
                <DropdownMenuItem
                  key={plugin.id}
                  onSelect={() => openNew(plugin)}
                  data-testid={`menu-new-${plugin.id}`}
                >
                  {plugin.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {sortedPlugins.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground" data-testid="text-empty-manifest">
              No plugins available for this kind.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {sortedPlugins.map((plugin) => {
            const pluginConfigs = configs.filter((c) => c.pluginId === plugin.id);
            return (
              <Card key={plugin.id} data-testid={`card-plugin-${plugin.id}`}>
                <CardHeader>
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex-1">
                      <CardTitle data-testid={`text-plugin-name-${plugin.id}`}>{plugin.name}</CardTitle>
                      {plugin.description && (
                        <CardDescription className="mt-2">{plugin.description}</CardDescription>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-xs" data-testid={`badge-count-${plugin.id}`}>
                      {pluginConfigs.length} configuration{pluginConfigs.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {pluginConfigs.length > 0 ? (
                    <div className="space-y-3" data-testid={`list-configs-${plugin.id}`}>
                      {pluginConfigs.map((config) => (
                        <div
                          key={config.id}
                          className="flex items-center justify-between gap-4 p-4 border rounded-md flex-wrap"
                          data-testid={`row-config-${config.id}`}
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-3">
                              <Badge variant={config.enabled ? "default" : "secondary"}>
                                {config.enabled ? "Enabled" : "Disabled"}
                              </Badge>
                              <span className="text-sm font-medium" data-testid={`text-config-name-${config.id}`}>
                                {config.name || "—"}
                              </span>
                            </div>
                            <ConfigSummary config={config} />
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEdit(plugin, config)}
                              data-testid={`button-edit-${config.id}`}
                            >
                              <Settings className="mr-2 h-4 w-4" />
                              Edit
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="outline" size="sm" data-testid={`button-delete-${config.id}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Configuration</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this configuration? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteMutation.mutate(config.id)}
                                    data-testid={`button-confirm-delete-${config.id}`}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <p className="text-sm text-muted-foreground" data-testid={`text-empty-${plugin.id}`}>
                        No configurations yet.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openNew(plugin)}
                        data-testid={`button-add-${plugin.id}`}
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Configuration
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {dialogPlugin && (
        <GenericConfigDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          kind={kind}
          plugin={dialogPlugin}
          config={dialogConfig}
          envelopeFields={envelopeFields}
        />
      )}
    </div>
  );
}

/** Read-only key/value preview of a config's non-base (subsidiary + data) fields. */
function ConfigSummary({ config }: { config: PluginConfigRow }) {
  const extras = Object.entries(config).filter(([k]) => !BASE_KEYS.has(k));
  return (
    <div className="mt-1 space-y-0.5 text-sm text-muted-foreground" data-testid={`summary-config-${config.id}`}>
      <p>
        <strong>Plugin:</strong> {config.pluginId} · <strong>Order:</strong> {config.ordering}
      </p>
      {extras.length > 0 && (
        <p className="truncate max-w-xl">
          {extras.map(([k, v]) => `${k}: ${v === null || v === undefined ? "—" : String(v)}`).join(" · ")}
        </p>
      )}
    </div>
  );
}

interface GenericConfigDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ArrayManifestPluginKind;
  plugin: ManifestEntry;
  config?: PluginConfigRow | null;
  envelopeFields: PluginConfigEnvelopeField[];
}

/**
 * Generic add/edit dialog. Base envelope fields (name / enabled / ordering)
 * are plain inputs; the kind's relational (subsidiary) fields are rendered
 * from the adapter-provided `envelopeFields` metadata; the plugin-specific
 * settings (`data`) are rendered by the server-provided JSON Schema via
 * SchemaForm. Nothing here is kind-specific — adding a relational field to a
 * kind is a server-only change.
 */
function GenericConfigDialog({
  open,
  onOpenChange,
  kind,
  plugin,
  config,
  envelopeFields,
}: GenericConfigDialogProps) {
  const { toast } = useToast();
  const isEditMode = !!config;
  const submitBtnRef = useRef<HTMLButtonElement>(null);
  const settingsSchema = plugin.configSchema ?? { type: "object", properties: {} };

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [ordering, setOrdering] = useState(0);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [envelope, setEnvelope] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (config) {
      setName(config.name ?? "");
      setEnabled(config.enabled);
      setOrdering(config.ordering ?? 0);
      setSettings(
        sortArrayTableSettings(settingsSchema, (config.data as Record<string, unknown>) ?? {}),
      );
      setEnvelope(
        Object.fromEntries(
          envelopeFields.map((f) => {
            const v = config[f.name];
            return [f.name, v === null || v === undefined ? "" : String(v)];
          }),
        ),
      );
    } else {
      setName("");
      setEnabled(false);
      setOrdering(0);
      setSettings({});
      setEnvelope(Object.fromEntries(envelopeFields.map((f) => [f.name, ""])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  const saveMutation = useMutation({
    mutationFn: async (validSettings: Record<string, unknown>) => {
      // Empty string → null for optional fields; coerce number-typed fields.
      const envelopeBody: Record<string, unknown> = {};
      for (const f of envelopeFields) {
        const raw = envelope[f.name] ?? "";
        if (raw === "") {
          envelopeBody[f.name] = null;
        } else if (f.type === "number") {
          envelopeBody[f.name] = Number(raw);
        } else {
          envelopeBody[f.name] = raw;
        }
      }
      const body = {
        pluginId: plugin.id,
        name: name.trim() || null,
        enabled,
        ordering,
        ...envelopeBody,
        data: validSettings,
      };
      if (isEditMode && config) {
        return apiRequest("PATCH", `${pluginConfigsUrl(kind)}/${config.id}`, body);
      }
      return apiRequest("POST", pluginConfigsUrl(kind), body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: pluginConfigsQueryKey(kind) });
      toast({ title: "Success", description: `Configuration ${isEditMode ? "updated" : "created"}.` });
      onOpenChange(false);
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : `Failed to ${isEditMode ? "update" : "create"} configuration.`,
        variant: "destructive",
      });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="dialog-title">
            {isEditMode ? "Edit Configuration" : "New Configuration"}
          </DialogTitle>
          <DialogDescription>{plugin.name}</DialogDescription>
        </DialogHeader>

        <div className="py-2 flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 border rounded-md">
              <div>
                <Label>Enabled</Label>
                <p className="text-sm text-muted-foreground">
                  When enabled, this configuration is active.
                </p>
              </div>
              <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-enabled" />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="Optional label"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="input-name"
                />
              </div>
              <div className="space-y-1">
                <Label>Ordering</Label>
                <Input
                  type="number"
                  value={ordering}
                  onChange={(e) => setOrdering(Number(e.target.value) || 0)}
                  data-testid="input-ordering"
                />
              </div>
            </div>

            {envelopeFields.length > 0 && (
              <div className="grid grid-cols-2 gap-4" data-testid="envelope-fields">
                {envelopeFields.map((field) => (
                  <div className="space-y-1" key={field.name}>
                    <Label>
                      {field.label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    <Input
                      type={field.type === "number" ? "number" : "text"}
                      placeholder={field.required ? "Required" : "Optional"}
                      value={envelope[field.name] ?? ""}
                      onChange={(e) =>
                        setEnvelope((prev) => ({ ...prev, [field.name]: e.target.value }))
                      }
                      data-testid={`input-envelope-${field.name}`}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <SchemaForm
              schema={settingsSchema}
              formData={settings}
              showErrorList="top"
              onChange={(e: IChangeEvent) => setSettings(e.formData as Record<string, unknown>)}
              onSubmit={(e: IChangeEvent) => saveMutation.mutate(e.formData as Record<string, unknown>)}
            >
              <button ref={submitBtnRef} type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </SchemaForm>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saveMutation.isPending}
            data-testid="button-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => submitBtnRef.current?.click()}
            disabled={saveMutation.isPending}
            data-testid="button-save-config"
          >
            {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "Update" : "Create"} Configuration
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
