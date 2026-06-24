import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { PolicyLayout, usePolicyLayout } from "@/components/layouts/PolicyLayout";
import { SchemaForm } from "@/components/json-schema-form";
import type { IChangeEvent } from "@/components/json-schema-form";
import { SchemaView } from "@/components/json-schema-form/SchemaView";
import {
  pluginManifestQueryKey,
  pluginConfigsUrl,
  pluginSearch,
} from "@/plugins/_core/manifest";
import { TrustBenefit } from "@shared/schema";
import type { JsonSchema } from "@shared/json-schema-form";
import { Loader2, Plus, Pencil, AlertTriangle } from "lucide-react";

const KIND = "trust-eligibility" as const;

interface PolicyData {
  benefitIds?: string[];
}

/** One trust-eligibility plugin as returned by the manifest endpoint. */
interface EligibilityManifestEntry {
  id: string;
  name: string;
  description?: string;
  configSchema?: JsonSchema;
}

/** A hydrated trust-eligibility config row (base + subsidiary flattened). */
interface EligibilityConfigRow {
  id: string;
  pluginId: string;
  name: string | null;
  enabled: boolean;
  data: Record<string, unknown> | null;
  policy: string | null;
  benefit: string | null;
  /** Denormalized comma-joined phase list (e.g. "start,continue"). */
  appliesTo: string | null;
}

const PHASES: { value: "start" | "continue"; label: string }[] = [
  { value: "start", label: "Start" },
  { value: "continue", label: "Continue" },
];

function phaseLabel(value: string): string {
  return PHASES.find((p) => p.value === value)?.label ?? value;
}

function splitPhases(appliesTo: string | null): string[] {
  return (appliesTo ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function PolicyEligibilityContent() {
  const { policy } = usePolicyLayout();
  const { toast } = useToast();

  const policyData = (policy.data as PolicyData) || {};
  const policyBenefitIds = useMemo(
    () => new Set(policyData.benefitIds || []),
    [policyData.benefitIds],
  );

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: benefits = [] } = useQuery<TrustBenefit[]>({
    queryKey: ["/api/trust-benefits"],
  });

  const { data: manifest = [] } = useQuery<EligibilityManifestEntry[]>({
    queryKey: pluginManifestQueryKey(KIND),
  });

  const {
    data: configs = [],
    isLoading: configsLoading,
  } = useQuery<EligibilityConfigRow[]>({
    queryKey: [pluginConfigsUrl(KIND), "policy", policy.id],
    queryFn: () => pluginSearch<typeof KIND, EligibilityConfigRow>(KIND, { policy: policy.id }),
  });

  const benefitName = (id: string | null): string => {
    if (!id) return "—";
    return benefits.find((b) => b.id === id)?.name ?? id;
  };

  const pluginName = (id: string): string =>
    manifest.find((p) => p.id === id)?.name ?? id;

  // Benefits the picker offers — only those attached to this policy.
  const policyBenefits = useMemo(
    () => benefits.filter((b) => policyBenefitIds.has(b.id)),
    [benefits, policyBenefitIds],
  );

  // Group existing configs by plugin for display.
  const grouped = useMemo(() => {
    const map = new Map<string, EligibilityConfigRow[]>();
    for (const c of configs) {
      const list = map.get(c.pluginId) ?? [];
      list.push(c);
      map.set(c.pluginId, list);
    }
    return Array.from(map.entries()).sort((a, b) =>
      pluginName(a[0]).localeCompare(pluginName(b[0])),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs, manifest]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const selectedConfigs = configs.filter((c) => selectedIds.has(c.id));
  const selectedPluginIds = new Set(selectedConfigs.map((c) => c.pluginId));
  const canBulkEdit = selectedConfigs.length > 0 && selectedPluginIds.size === 1;
  const editPluginId =
    selectedPluginIds.size === 1 ? Array.from(selectedPluginIds)[0] : null;
  const editPlugin = editPluginId
    ? manifest.find((p) => p.id === editPluginId) ?? null
    : null;

  const refresh = () => {
    queryClient.invalidateQueries({
      queryKey: [pluginConfigsUrl(KIND), "policy", policy.id],
    });
  };

  return (
    <div className="space-y-6" data-testid="page-policy-eligibility">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">
            Eligibility Configurations
          </h2>
          <p className="text-sm text-muted-foreground">
            Trust-eligibility rules scoped to this policy. Bulk-create across
            benefits and phases, or multi-select to apply one settings change.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            disabled={!canBulkEdit}
            onClick={() => setEditOpen(true)}
            data-testid="button-bulk-edit"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit Selected ({selectedConfigs.length})
          </Button>
          <Button
            disabled={policyBenefits.length === 0}
            onClick={() => setCreateOpen(true)}
            data-testid="button-bulk-create"
          >
            <Plus className="mr-2 h-4 w-4" />
            New Configurations
          </Button>
        </div>
      </div>

      {policyBenefits.length === 0 && (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground" data-testid="text-no-benefits">
              This policy has no benefits attached yet. Add benefits on the
              Benefits tab before configuring eligibility.
            </p>
          </CardContent>
        </Card>
      )}

      {configsLoading ? (
        <Card>
          <CardContent className="py-6 space-y-3">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </CardContent>
        </Card>
      ) : configs.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground" data-testid="text-no-configs">
              No eligibility configurations for this policy yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([pluginId, rows]) => {
            const pluginSchema =
              manifest.find((p) => p.id === pluginId)?.configSchema ?? null;
            return (
              <Card key={pluginId} data-testid={`card-plugin-${pluginId}`}>
                <CardHeader>
                  <CardTitle className="text-base" data-testid={`text-plugin-name-${pluginId}`}>
                    {pluginName(pluginId)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {rows.map((row) => {
                    const phases = splitPhases(row.appliesTo);
                    return (
                      <div
                        key={row.id}
                        className="flex items-start gap-3 rounded-md border p-3"
                        data-testid={`row-config-${row.id}`}
                      >
                        <Checkbox
                          className="mt-0.5"
                          checked={selectedIds.has(row.id)}
                          onCheckedChange={(checked) =>
                            toggleSelected(row.id, checked === true)
                          }
                          data-testid={`checkbox-config-${row.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-medium" data-testid={`text-config-benefit-${row.id}`}>
                            {benefitName(row.benefit)}
                          </div>
                          {row.name && (
                            <div className="text-xs text-muted-foreground">{row.name}</div>
                          )}
                          {pluginSchema && (
                            <div
                              className="mt-1.5 [&_dl]:text-xs [&_dl]:gap-y-0.5"
                              data-testid={`summary-config-${row.id}`}
                            >
                              <SchemaView
                                schema={pluginSchema}
                                value={row.data ?? {}}
                                omitKeys={["appliesTo"]}
                                hideEmpty
                                testIdPrefix={`summary-config-${row.id}`}
                              />
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          {phases.length === 0 ? (
                            <Badge variant="outline">No phase</Badge>
                          ) : (
                            phases.map((p) => (
                              <Badge
                                key={p}
                                variant="secondary"
                                data-testid={`badge-phase-${row.id}-${p}`}
                              >
                                {phaseLabel(p)}
                              </Badge>
                            ))
                          )}
                        </div>
                        <Badge
                          variant={row.enabled ? "default" : "outline"}
                          data-testid={`badge-enabled-${row.id}`}
                        >
                          {row.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <BulkCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        policyId={policy.id}
        manifest={manifest}
        benefits={policyBenefits}
        onCreated={() => {
          setCreateOpen(false);
          refresh();
        }}
      />

      <BulkEditDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        plugin={editPlugin}
        configIds={Array.from(selectedIds)}
        count={selectedConfigs.length}
        onSaved={() => {
          setEditOpen(false);
          setSelectedIds(new Set());
          refresh();
        }}
      />
    </div>
  );
}

interface BulkCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyId: string;
  manifest: EligibilityManifestEntry[];
  benefits: TrustBenefit[];
  onCreated: () => void;
}

function BulkCreateDialog({
  open,
  onOpenChange,
  policyId,
  manifest,
  benefits,
  onCreated,
}: BulkCreateDialogProps) {
  const { toast } = useToast();
  const submitRef = useRef<HTMLButtonElement>(null);

  const [pluginId, setPluginId] = useState("");
  const [selectedBenefits, setSelectedBenefits] = useState<Set<string>>(new Set());
  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<{ benefit: string; phase: string }[]>([]);

  // Reset state whenever the dialog opens.
  const prevOpen = useRef(false);
  if (open && !prevOpen.current) {
    setPluginId("");
    setSelectedBenefits(new Set());
    setSelectedPhases(new Set());
    setName("");
    setEnabled(false);
    setSettings({});
    setConflicts([]);
  }
  prevOpen.current = open;

  const plugin = manifest.find((p) => p.id === pluginId) ?? null;
  const settingsSchema: JsonSchema =
    plugin?.configSchema ?? { type: "object", properties: {} };

  const benefitName = (id: string): string =>
    benefits.find((b) => b.id === id)?.name ?? id;

  const toggleBenefit = (id: string, checked: boolean) =>
    setSelectedBenefits((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const togglePhase = (id: string, checked: boolean) =>
    setSelectedPhases((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = async (validSettings: Record<string, unknown>) => {
    if (!pluginId) {
      toast({ title: "Select a plugin", variant: "destructive" });
      return;
    }
    if (selectedBenefits.size === 0) {
      toast({ title: "Select at least one benefit", variant: "destructive" });
      return;
    }
    if (selectedPhases.size === 0) {
      toast({ title: "Select at least one phase", variant: "destructive" });
      return;
    }
    setConflicts([]);
    setSaving(true);
    try {
      await apiRequest("POST", `${pluginConfigsUrl(KIND)}/bulk`, {
        pluginId,
        policy: policyId,
        benefits: Array.from(selectedBenefits),
        phases: Array.from(selectedPhases),
        name: name.trim() || null,
        enabled,
        data: validSettings,
      });
      toast({ title: "Configurations created" });
      onCreated();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.data?.conflicts) {
        setConflicts(error.data.conflicts as { benefit: string; phase: string }[]);
        toast({
          title: "Conflicts found",
          description: "Some combinations already have a configuration. Nothing was created.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to create configurations.",
          variant: "destructive",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="dialog-bulk-create-title">New Configurations</DialogTitle>
          <DialogDescription>
            One plugin and settings applied across every selected benefit × phase.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
          <div className="space-y-1">
            <Label>Plugin</Label>
            <Select value={pluginId || undefined} onValueChange={setPluginId}>
              <SelectTrigger data-testid="select-bulk-plugin">
                <SelectValue placeholder="Select a plugin…" />
              </SelectTrigger>
              <SelectContent>
                {manifest.map((p) => (
                  <SelectItem key={p.id} value={p.id} data-testid={`option-bulk-plugin-${p.id}`}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Benefits</Label>
            <div className="space-y-2 rounded-md border p-3" data-testid="group-bulk-benefits">
              {benefits.map((b) => (
                <div key={b.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`bulk-benefit-${b.id}`}
                    checked={selectedBenefits.has(b.id)}
                    onCheckedChange={(checked) => toggleBenefit(b.id, checked === true)}
                    data-testid={`checkbox-bulk-benefit-${b.id}`}
                  />
                  <Label htmlFor={`bulk-benefit-${b.id}`} className="font-normal cursor-pointer">
                    {b.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Phases</Label>
            <div className="space-y-2 rounded-md border p-3" data-testid="group-bulk-phases">
              {PHASES.map((p) => (
                <div key={p.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`bulk-phase-${p.value}`}
                    checked={selectedPhases.has(p.value)}
                    onCheckedChange={(checked) => togglePhase(p.value, checked === true)}
                    data-testid={`checkbox-bulk-phase-${p.value}`}
                  />
                  <Label htmlFor={`bulk-phase-${p.value}`} className="font-normal cursor-pointer">
                    {p.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Enabled</Label>
              <p className="text-sm text-muted-foreground">
                When enabled, the created configurations are active.
              </p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} data-testid="switch-bulk-enabled" />
          </div>

          <div className="space-y-1">
            <Label>Name</Label>
            <Input
              placeholder="Optional label"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-bulk-name"
            />
          </div>

          {pluginId && (
            <div className="border-t pt-4">
              <p className="text-sm font-medium mb-2">Plugin settings</p>
              <SchemaForm
                schema={settingsSchema}
                formData={settings}
                showErrorList="top"
                onChange={(e: IChangeEvent) => setSettings(e.formData as Record<string, unknown>)}
                onSubmit={(e: IChangeEvent) => submit(e.formData as Record<string, unknown>)}
              >
                <button ref={submitRef} type="submit" hidden aria-hidden="true" tabIndex={-1} />
              </SchemaForm>
            </div>
          )}

          {conflicts.length > 0 && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1"
              data-testid="list-conflicts"
            >
              <div className="flex items-center gap-2 text-destructive font-medium text-sm">
                <AlertTriangle className="h-4 w-4" />
                Existing configurations conflict
              </div>
              <ul className="text-sm text-muted-foreground list-disc pl-5">
                {conflicts.map((c, i) => (
                  <li key={`${c.benefit}-${c.phase}-${i}`} data-testid={`conflict-${c.benefit}-${c.phase}`}>
                    {benefitName(c.benefit)} — {phaseLabel(c.phase)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            data-testid="button-bulk-create-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => submitRef.current?.click()}
            disabled={saving || !pluginId}
            data-testid="button-bulk-create-submit"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plugin: EligibilityManifestEntry | null;
  configIds: string[];
  count: number;
  onSaved: () => void;
}

function BulkEditDialog({
  open,
  onOpenChange,
  plugin,
  configIds,
  count,
  onSaved,
}: BulkEditDialogProps) {
  const { toast } = useToast();
  const submitRef = useRef<HTMLButtonElement>(null);

  type EnabledChoice = "no-change" | "enabled" | "disabled";

  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [enabledChoice, setEnabledChoice] = useState<EnabledChoice>("no-change");
  const [saving, setSaving] = useState(false);

  const prevOpen = useRef(false);
  if (open && !prevOpen.current) {
    setSettings({});
    setEnabledChoice("no-change");
  }
  prevOpen.current = open;

  const settingsSchema: JsonSchema =
    plugin?.configSchema ?? { type: "object", properties: {} };

  // Whether the user has entered any settings to push. Empty means "leave each
  // config's current settings untouched" — useful for a pure enable/disable.
  const hasSettings = Object.keys(settings).length > 0;
  const nothingToApply = !hasSettings && enabledChoice === "no-change";

  const submit = async (
    validSettings: Record<string, unknown>,
    includeSettings: boolean,
  ) => {
    const enabled =
      enabledChoice === "no-change" ? undefined : enabledChoice === "enabled";
    if (!includeSettings && enabled === undefined) {
      toast({
        title: "Nothing to apply",
        description: "Change the settings, enable/disable, or both.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ids: configIds };
      if (includeSettings) body.data = validSettings;
      if (enabled !== undefined) body.enabled = enabled;
      await apiRequest("POST", `${pluginConfigsUrl(KIND)}/bulk-settings`, body);
      toast({ title: "Changes applied", description: `Updated ${count} configuration(s).` });
      onSaved();
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to apply changes.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleApply = () => {
    // When settings were entered, run them through the schema form so invalid
    // input is caught before submit; otherwise submit the enabled-only change.
    if (hasSettings) submitRef.current?.click();
    else submit({}, false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col max-h-[85vh] sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle data-testid="dialog-bulk-edit-title">Edit Selected Configurations</DialogTitle>
          <DialogDescription>
            {plugin ? plugin.name : ""} — applies one change to {count} configuration(s).
            Each configuration keeps its own benefit and phase.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Status</Label>
              <p className="text-sm text-muted-foreground">
                Enable or disable all selected configurations.
              </p>
            </div>
            <Select
              value={enabledChoice}
              onValueChange={(v) => setEnabledChoice(v as EnabledChoice)}
            >
              <SelectTrigger className="w-40" data-testid="select-bulk-edit-enabled">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-change" data-testid="option-bulk-edit-enabled-no-change">
                  No change
                </SelectItem>
                <SelectItem value="enabled" data-testid="option-bulk-edit-enabled-enable">
                  Enable all
                </SelectItem>
                <SelectItem value="disabled" data-testid="option-bulk-edit-enabled-disable">
                  Disable all
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="border-t pt-4">
            <p className="text-sm font-medium mb-1">Plugin settings</p>
            <p className="text-xs text-muted-foreground mb-3">
              Optional — leave blank to keep each configuration's current settings.
            </p>
            <SchemaForm
              schema={settingsSchema}
              formData={settings}
              showErrorList="top"
              onChange={(e: IChangeEvent) => setSettings(e.formData as Record<string, unknown>)}
              onSubmit={(e: IChangeEvent) =>
                submit(e.formData as Record<string, unknown>, true)
              }
            >
              <button ref={submitRef} type="submit" hidden aria-hidden="true" tabIndex={-1} />
            </SchemaForm>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            data-testid="button-bulk-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={handleApply}
            disabled={saving || nothingToApply}
            data-testid="button-bulk-edit-submit"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function PolicyEligibility() {
  return (
    <PolicyLayout activeTab="eligibility">
      <PolicyEligibilityContent />
    </PolicyLayout>
  );
}
