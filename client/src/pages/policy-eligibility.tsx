import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

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

/** Deep sort object keys so JSON.stringify yields a canonical string. */
function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.keys(o)
      .sort()
      .reduce((acc, k) => {
        acc[k] = sortKeysDeep(o[k]);
        return acc;
      }, {} as Record<string, unknown>);
  }
  return v;
}

/**
 * Canonical fingerprint of everything about a config EXCEPT which benefit
 * it targets: plugin settings (minus the appliesTo envelope mirror),
 * phases, enabled state, and label. Configs sharing a fingerprint are
 * presented as one grouped row.
 */
function settingsFingerprint(row: EligibilityConfigRow): string {
  const { appliesTo: _omit, ...rest } = (row.data ?? {}) as Record<string, unknown>;
  return JSON.stringify({
    data: sortKeysDeep(rest),
    phases: splitPhases(row.appliesTo).sort(),
    enabled: row.enabled,
    name: row.name ?? null,
  });
}

/**
 * Detect phase-split rows that could be combined: configs targeting the
 * same benefit with identical settings, enabled state, and name, but
 * disjoint phase lists (e.g. a Start-only row + a Continue-only row).
 * Returns the number of such mergeable sets. Mirrors the server-side
 * grouping in the merge-phases endpoint.
 */
function countMergeablePairs(rows: EligibilityConfigRow[]): number {
  const map = new Map<string, EligibilityConfigRow[]>();
  for (const row of rows) {
    const { appliesTo: _omit, ...rest } = (row.data ?? {}) as Record<string, unknown>;
    const key = JSON.stringify({
      benefit: row.benefit ?? null,
      data: sortKeysDeep(rest),
      enabled: row.enabled,
      name: row.name ?? null,
    });
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  let count = 0;
  for (const list of map.values()) {
    if (list.length < 2) continue;
    const seen = new Set<string>();
    let overlap = false;
    for (const row of list) {
      for (const p of splitPhases(row.appliesTo)) {
        if (seen.has(p)) overlap = true;
        seen.add(p);
      }
    }
    if (!overlap && seen.size > 0) count += 1;
  }
  return count;
}

interface SettingsGroup {
  key: string;
  rows: EligibilityConfigRow[];
}

/** Group a plugin's configs by settings fingerprint, biggest groups first. */
function groupBySettings(rows: EligibilityConfigRow[]): SettingsGroup[] {
  const map = new Map<string, EligibilityConfigRow[]>();
  for (const row of rows) {
    const key = settingsFingerprint(row);
    const list = map.get(key) ?? [];
    list.push(row);
    map.set(key, list);
  }
  return Array.from(map.entries())
    .map(([key, list]) => ({ key, rows: list }))
    .sort((a, b) => b.rows.length - a.rows.length);
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
  const [singleEditRow, setSingleEditRow] = useState<EligibilityConfigRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enabledFilter, setEnabledFilter] = useState<"all" | "enabled" | "disabled">("all");
  const [deleteRow, setDeleteRow] = useState<EligibilityConfigRow | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupEditRows, setGroupEditRows] = useState<EligibilityConfigRow[] | null>(null);
  const [groupDeleteRows, setGroupDeleteRows] = useState<EligibilityConfigRow[] | null>(null);
  const [addBenefitsRows, setAddBenefitsRows] = useState<EligibilityConfigRow[] | null>(null);
  const [addBenefitsSelected, setAddBenefitsSelected] = useState<Set<string>>(new Set());
  const [addingBenefits, setAddingBenefits] = useState(false);

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

  // Rows currently visible under the Enabled/Disabled filter.
  const visibleConfigs = useMemo(
    () =>
      enabledFilter === "all"
        ? configs
        : configs.filter((c) => c.enabled === (enabledFilter === "enabled")),
    [configs, enabledFilter],
  );

  // Group visible configs by plugin for display.
  const grouped = useMemo(() => {
    const map = new Map<string, EligibilityConfigRow[]>();
    for (const c of visibleConfigs) {
      const list = map.get(c.pluginId) ?? [];
      list.push(c);
      map.set(c.pluginId, list);
    }
    return Array.from(map.entries()).sort((a, b) =>
      pluginName(a[0]).localeCompare(pluginName(b[0])),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleConfigs, manifest]);

  const toggleSelected = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleGroupSelected = (rows: EligibilityConfigRow[], checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  };

  // Selection only counts rows that are currently visible — rows hidden by
  // the filter are excluded from bulk actions even if their id lingers in
  // selectedIds from before the filter change.
  const selectedConfigs = visibleConfigs.filter((c) => selectedIds.has(c.id));
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

  // Automatic phase merge: the server already collapses Start-only /
  // Continue-only pairs on every write, so mergeable pairs can only appear
  // here from legacy data. When we spot any, merge them silently in the
  // background — no user intervention.
  //
  // Keys are policy-scoped (`policy.id:pluginId`) so switching policies
  // without a remount still merges. "Done" is only recorded on SUCCESS; a
  // failed call clears its in-flight marker so the next configs refetch
  // retries. The in-flight set prevents duplicate concurrent calls, and the
  // done set prevents loops once a merge (or a no-op check) has succeeded.
  const autoMergeDoneRef = useRef<Set<string>>(new Set());
  const autoMergeInFlightRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (configsLoading) return;
    const pluginIds = Array.from(new Set(configs.map((c) => c.pluginId)));
    for (const pluginId of pluginIds) {
      const key = `${policy.id}:${pluginId}`;
      if (autoMergeDoneRef.current.has(key)) continue;
      if (autoMergeInFlightRef.current.has(key)) continue;
      const mergeable = countMergeablePairs(
        configs.filter((c) => c.pluginId === pluginId),
      );
      if (mergeable === 0) continue;
      autoMergeInFlightRef.current.add(key);
      apiRequest("POST", `${pluginConfigsUrl(KIND)}/merge-phases`, {
        pluginId,
        policy: policy.id,
      })
        .then((result: any) => {
          autoMergeDoneRef.current.add(key);
          if (result?.merged > 0) {
            toast({
              title: "Configurations merged automatically",
              description: `Start/Continue rows with the same settings were combined (${result.removed} duplicate${result.removed === 1 ? "" : "s"} removed).`,
            });
            refresh();
          }
        })
        .catch(() => {
          // Opportunistic cleanup — no error toast. Not marking "done" lets
          // the next configs refetch retry; the next write also merges
          // server-side regardless.
        })
        .finally(() => {
          autoMergeInFlightRef.current.delete(key);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configs, configsLoading, policy.id]);

  // Clone a group's exact settings/phases/enabled/name onto newly picked
  // benefits. Uses bulk-create with combinePhases (so a combined
  // "start,continue" group stays combined and the new rows share its
  // fingerprint) and overwrite (any existing config on a picked benefit
  // covering these phases gets replaced).
  const addBenefits = async () => {
    if (!addBenefitsRows || addBenefitsRows.length === 0) return;
    const first = addBenefitsRows[0];
    const phases = splitPhases(first.appliesTo);
    const benefitIds = Array.from(addBenefitsSelected);
    if (benefitIds.length === 0 || phases.length === 0) return;
    const { appliesTo: _omit, ...settings } = (first.data ?? {}) as Record<string, unknown>;
    setAddingBenefits(true);
    try {
      const result = (await apiRequest("POST", `${pluginConfigsUrl(KIND)}/bulk`, {
        pluginId: first.pluginId,
        policy: policy.id,
        benefits: benefitIds,
        phases,
        name: first.name ?? null,
        enabled: first.enabled,
        data: settings,
        overwrite: true,
        combinePhases: true,
      })) as { created: number; replaced?: number };
      toast({
        title: "Benefits added",
        description: `${result.created} configuration${result.created === 1 ? "" : "s"} created${
          result.replaced && result.replaced > 0
            ? `, ${result.replaced} existing one${result.replaced === 1 ? "" : "s"} replaced`
            : ""
        }.`,
      });
      setAddBenefitsRows(null);
      setAddBenefitsSelected(new Set());
      refresh();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to add benefits.",
        variant: "destructive",
      });
    } finally {
      setAddingBenefits(false);
    }
  };

  const deleteOne = async () => {
    if (!deleteRow) return;
    setDeleting(true);
    try {
      await apiRequest("DELETE", `${pluginConfigsUrl(KIND)}/${deleteRow.id}`);
      toast({ title: "Configuration deleted" });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteRow.id);
        return next;
      });
      setDeleteRow(null);
      refresh();
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to delete the configuration.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const deleteMany = async (targets: EligibilityConfigRow[]) => {
    if (targets.length === 0) return;
    setDeleting(true);
    const failures: string[] = [];
    const deletedIds = new Set<string>();
    for (const row of targets) {
      try {
        await apiRequest("DELETE", `${pluginConfigsUrl(KIND)}/${row.id}`);
        deletedIds.add(row.id);
      } catch (error) {
        const label = `${benefitName(row.benefit)}${row.name ? ` (${row.name})` : ""}`;
        failures.push(
          `${label}: ${error instanceof Error ? error.message : "delete failed"}`,
        );
      }
    }
    setDeleting(false);
    setBulkDeleteOpen(false);
    setGroupDeleteRows(null);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of Array.from(deletedIds)) next.delete(id);
      return next;
    });
    refresh();
    if (failures.length === 0) {
      toast({
        title: `Deleted ${deletedIds.size} configuration${deletedIds.size === 1 ? "" : "s"}`,
      });
    } else {
      toast({
        title: `Deleted ${deletedIds.size} of ${targets.length} configurations`,
        description: failures.join("; "),
        variant: "destructive",
      });
    }
  };

  const deleteSelected = () => deleteMany(selectedConfigs);

  const toggleExpanded = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const groupEditPlugin =
    groupEditRows && groupEditRows.length > 0
      ? manifest.find((p) => p.id === groupEditRows[0].pluginId) ?? null
      : null;

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
          <Select
            value={enabledFilter}
            onValueChange={(v) => setEnabledFilter(v as typeof enabledFilter)}
          >
            <SelectTrigger className="w-[150px]" data-testid="select-enabled-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="enabled">Enabled only</SelectItem>
              <SelectItem value="disabled">Disabled only</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            disabled={selectedConfigs.length === 0 || deleting}
            onClick={() => setBulkDeleteOpen(true)}
            data-testid="button-bulk-delete"
          >
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Selected ({selectedConfigs.length})
          </Button>
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
      ) : visibleConfigs.length === 0 ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm text-muted-foreground" data-testid="text-no-filtered-configs">
              No {enabledFilter === "enabled" ? "enabled" : "disabled"} configurations
              for this policy.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([pluginId, rows]) => {
            const pluginSchema =
              manifest.find((p) => p.id === pluginId)?.configSchema ?? null;
            const selectedInGroup = rows.filter((r) => selectedIds.has(r.id)).length;
            const allSelected = selectedInGroup === rows.length && rows.length > 0;
            const someSelected = selectedInGroup > 0 && !allSelected;
            return (
              <Card key={pluginId} data-testid={`card-plugin-${pluginId}`}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={allSelected ? true : someSelected ? "indeterminate" : false}
                      onCheckedChange={() => toggleGroupSelected(rows, !allSelected)}
                      aria-label={
                        allSelected
                          ? `Deselect all ${pluginName(pluginId)} configurations`
                          : `Select all ${pluginName(pluginId)} configurations`
                      }
                      data-testid={`checkbox-select-all-${pluginId}`}
                    />
                    <CardTitle className="text-base" data-testid={`text-plugin-name-${pluginId}`}>
                      {pluginName(pluginId)}
                    </CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {groupBySettings(rows).map((group) => {
                    const first = group.rows[0];
                    const phases = splitPhases(first.appliesTo);
                    const isGroup = group.rows.length > 1;
                    const groupKey = `${pluginId}:${group.key}`;
                    const expanded = expandedGroups.has(groupKey);
                    const selectedInThisGroup = group.rows.filter((r) =>
                      selectedIds.has(r.id),
                    ).length;
                    const groupAllSelected =
                      selectedInThisGroup === group.rows.length;
                    const groupSomeSelected =
                      selectedInThisGroup > 0 && !groupAllSelected;
                    const sortedMembers = [...group.rows].sort((a, b) =>
                      benefitName(a.benefit).localeCompare(benefitName(b.benefit)),
                    );
                    return (
                      <div
                        key={groupKey}
                        className="rounded-md border"
                        data-testid={`row-group-${first.id}`}
                      >
                        <div className="flex items-start gap-3 p-3">
                          <Checkbox
                            className="mt-0.5"
                            checked={
                              groupAllSelected
                                ? true
                                : groupSomeSelected
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={(checked) =>
                              isGroup
                                ? toggleGroupSelected(group.rows, checked === true)
                                : toggleSelected(first.id, checked === true)
                            }
                            data-testid={`checkbox-config-${first.id}`}
                          />
                          <div className="flex-1 min-w-0">
                            {isGroup ? (
                              <div className="flex flex-wrap items-center gap-1.5">
                                {sortedMembers.map((r) => (
                                  <Badge
                                    key={r.id}
                                    variant="outline"
                                    className="font-normal"
                                    data-testid={`chip-benefit-${r.id}`}
                                  >
                                    {benefitName(r.benefit)}
                                  </Badge>
                                ))}
                                <span className="text-xs text-muted-foreground">
                                  {group.rows.length} benefits, same settings
                                </span>
                              </div>
                            ) : (
                              <div
                                className="font-medium"
                                data-testid={`text-config-benefit-${first.id}`}
                              >
                                {benefitName(first.benefit)}
                              </div>
                            )}
                            {first.name && (
                              <div className="text-xs text-muted-foreground">
                                {first.name}
                              </div>
                            )}
                            {pluginSchema && (
                              <div
                                className="mt-1.5 [&_dl]:text-xs [&_dl]:gap-y-0.5"
                                data-testid={`summary-config-${first.id}`}
                              >
                                <SchemaView
                                  schema={pluginSchema}
                                  value={first.data ?? {}}
                                  omitKeys={["appliesTo"]}
                                  hideEmpty
                                  testIdPrefix={`summary-config-${first.id}`}
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
                                  data-testid={`badge-phase-${first.id}-${p}`}
                                >
                                  {phaseLabel(p)}
                                </Badge>
                              ))
                            )}
                          </div>
                          <Badge
                            variant={first.enabled ? "default" : "outline"}
                            data-testid={`badge-enabled-${first.id}`}
                          >
                            {first.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          {phases.length > 0 && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 -my-1"
                              title="Add benefits with these settings"
                              onClick={() => {
                                setAddBenefitsSelected(new Set());
                                setAddBenefitsRows(group.rows);
                              }}
                              data-testid={`button-add-benefits-${first.id}`}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 -my-1"
                            onClick={() =>
                              isGroup
                                ? setGroupEditRows(group.rows)
                                : setSingleEditRow(first)
                            }
                            data-testid={`button-edit-config-${first.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 -my-1 text-destructive hover:text-destructive"
                            onClick={() =>
                              isGroup
                                ? setGroupDeleteRows(group.rows)
                                : setDeleteRow(first)
                            }
                            data-testid={`button-delete-config-${first.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {isGroup && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 -my-1"
                              onClick={() => toggleExpanded(groupKey)}
                              aria-label={
                                expanded
                                  ? "Collapse benefit list"
                                  : "Expand to edit individual benefits"
                              }
                              data-testid={`button-expand-group-${first.id}`}
                            >
                              {expanded ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                        </div>
                        {isGroup && expanded && (
                          <div className="border-t divide-y bg-muted/30">
                            {sortedMembers.map((row) => (
                              <div
                                key={row.id}
                                className="flex items-center gap-3 px-3 py-2 pl-10"
                                data-testid={`row-config-${row.id}`}
                              >
                                <Checkbox
                                  checked={selectedIds.has(row.id)}
                                  onCheckedChange={(checked) =>
                                    toggleSelected(row.id, checked === true)
                                  }
                                  data-testid={`checkbox-config-${row.id}`}
                                />
                                <span
                                  className="flex-1 text-sm"
                                  data-testid={`text-config-benefit-${row.id}`}
                                >
                                  {benefitName(row.benefit)}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  title="Edit only this benefit (creates an override)"
                                  onClick={() => setSingleEditRow(row)}
                                  data-testid={`button-edit-config-${row.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteRow(row)}
                                  data-testid={`button-delete-config-${row.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog
        open={addBenefitsRows !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddBenefitsRows(null);
            setAddBenefitsSelected(new Set());
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle data-testid="dialog-add-benefits-title">Add Benefits</DialogTitle>
            <DialogDescription>
              {addBenefitsRows && addBenefitsRows.length > 0 && (
                <>
                  New configurations for{" "}
                  <span className="font-medium text-foreground">
                    {pluginName(addBenefitsRows[0].pluginId)}
                  </span>{" "}
                  with the same settings, phases (
                  {splitPhases(addBenefitsRows[0].appliesTo)
                    .map(phaseLabel)
                    .join(", ") || "none"}
                  ), and enabled state as this row. Benefits that already have a
                  configuration for these phases will have it replaced.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-y-auto space-y-2 py-1">
            {(() => {
              const inGroup = new Set(
                (addBenefitsRows ?? []).map((r) => r.benefit),
              );
              const available = policyBenefits.filter((b) => !inGroup.has(b.id));
              if (available.length === 0) {
                return (
                  <p className="text-sm text-muted-foreground" data-testid="text-no-addable-benefits">
                    Every benefit on this policy is already in this configuration.
                  </p>
                );
              }
              return available.map((b) => (
                <label
                  key={b.id}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Checkbox
                    checked={addBenefitsSelected.has(b.id)}
                    onCheckedChange={(checked) =>
                      setAddBenefitsSelected((prev) => {
                        const next = new Set(prev);
                        if (checked === true) next.add(b.id);
                        else next.delete(b.id);
                        return next;
                      })
                    }
                    data-testid={`checkbox-add-benefit-${b.id}`}
                  />
                  {b.name}
                </label>
              ));
            })()}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddBenefitsRows(null);
                setAddBenefitsSelected(new Set());
              }}
              data-testid="button-cancel-add-benefits"
            >
              Cancel
            </Button>
            <Button
              onClick={addBenefits}
              disabled={addingBenefits || addBenefitsSelected.size === 0}
              data-testid="button-confirm-add-benefits"
            >
              {addingBenefits && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Add {addBenefitsSelected.size > 0 ? `(${addBenefitsSelected.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
        configIds={selectedConfigs.map((c) => c.id)}
        count={selectedConfigs.length}
        benefits={benefits}
        onSaved={() => {
          setEditOpen(false);
          setSelectedIds(new Set());
          refresh();
        }}
      />

      <BulkEditDialog
        open={groupEditRows !== null}
        onOpenChange={(open) => {
          if (!open) setGroupEditRows(null);
        }}
        plugin={groupEditPlugin}
        configIds={(groupEditRows ?? []).map((c) => c.id)}
        count={groupEditRows?.length ?? 0}
        benefits={benefits}
        onSaved={() => {
          setGroupEditRows(null);
          refresh();
        }}
      />

      <SingleEditDialog
        row={singleEditRow}
        onOpenChange={(open) => {
          if (!open) setSingleEditRow(null);
        }}
        plugin={
          singleEditRow
            ? manifest.find((p) => p.id === singleEditRow.pluginId) ?? null
            : null
        }
        benefits={benefits}
        onSaved={() => {
          setSingleEditRow(null);
          refresh();
        }}
      />

      <AlertDialog
        open={deleteRow !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteRow(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="dialog-delete-title">
              Delete this configuration?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow
                ? `${pluginName(deleteRow.pluginId)} — ${benefitName(deleteRow.benefit)}. `
                : ""}
              This permanently removes the eligibility rule. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="button-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                deleteOne();
              }}
              data-testid="button-delete-confirm"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!deleting) setBulkDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="dialog-bulk-delete-title">
              Delete {selectedConfigs.length} configuration
              {selectedConfigs.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the selected eligibility rules. This cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="button-bulk-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                deleteSelected();
              }}
              data-testid="button-bulk-delete-confirm"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={groupDeleteRows !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setGroupDeleteRows(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="dialog-group-delete-title">
              Delete {groupDeleteRows?.length ?? 0} configuration
              {(groupDeleteRows?.length ?? 0) === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {groupDeleteRows && groupDeleteRows.length > 0
                ? `${pluginName(groupDeleteRows[0].pluginId)} — ${groupDeleteRows
                    .map((r) => benefitName(r.benefit))
                    .join(", ")}. `
                : ""}
              This permanently removes every eligibility rule in this group. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} data-testid="button-group-delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                if (groupDeleteRows) deleteMany(groupDeleteRows);
              }}
              data-testid="button-group-delete-confirm"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

interface SingleEditDialogProps {
  row: EligibilityConfigRow | null;
  onOpenChange: (open: boolean) => void;
  plugin: EligibilityManifestEntry | null;
  benefits: TrustBenefit[];
  onSaved: () => void;
}

/**
 * Per-rule edit dialog: change the rule's phases (Start/Continue) and its
 * plugin settings. Phases live OUTSIDE the RJSF form (the plugin's JSON
 * Schema doesn't include appliesTo, so RJSF would strip it) and are sent as
 * the top-level `appliesTo` envelope field the adapter already understands.
 */
function SingleEditDialog({
  row,
  onOpenChange,
  plugin,
  benefits,
  onSaved,
}: SingleEditDialogProps) {
  const { toast } = useToast();
  const submitRef = useRef<HTMLButtonElement>(null);

  const [selectedPhases, setSelectedPhases] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<{ benefit: string; phase: string }[]>([]);

  const open = row !== null;

  // Prefill from the row each time the dialog opens for a (possibly new) row.
  const prevRowId = useRef<string | null>(null);
  if (row && prevRowId.current !== row.id) {
    setSelectedPhases(new Set(splitPhases(row.appliesTo)));
    const { appliesTo: _omit, ...rest } = (row.data ?? {}) as Record<string, unknown>;
    setSettings(rest);
    setConflicts([]);
  }
  prevRowId.current = row?.id ?? null;

  const settingsSchema: JsonSchema =
    plugin?.configSchema ?? { type: "object", properties: {} };

  const benefitName = (id: string): string =>
    benefits.find((b) => b.id === id)?.name ?? id;

  const togglePhase = (id: string, checked: boolean) =>
    setSelectedPhases((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const submit = async (validSettings: Record<string, unknown>) => {
    if (!row) return;
    if (selectedPhases.size === 0) {
      toast({ title: "Select at least one phase", variant: "destructive" });
      return;
    }
    setConflicts([]);
    setSaving(true);
    try {
      await apiRequest("PATCH", `${pluginConfigsUrl(KIND)}/${row.id}`, {
        appliesTo: PHASES.filter((p) => selectedPhases.has(p.value))
          .map((p) => p.value)
          .join(","),
        data: validSettings,
      });
      toast({ title: "Configuration updated" });
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.data?.conflicts) {
        setConflicts(error.data.conflicts as { benefit: string; phase: string }[]);
        toast({
          title: "Conflict found",
          description:
            "Another configuration already covers a selected phase for this benefit. Nothing was changed.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description:
            error instanceof Error ? error.message : "Failed to update the configuration.",
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
          <DialogTitle data-testid="dialog-single-edit-title">Edit Configuration</DialogTitle>
          <DialogDescription>
            {plugin ? plugin.name : ""}
            {row?.benefit ? ` — ${benefitName(row.benefit)}` : ""}. Change the
            phases and plugin settings for this rule.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2 flex-1 min-h-0 overflow-y-auto pr-1 space-y-5">
          <div className="space-y-2">
            <Label>Phases</Label>
            <div className="space-y-2 rounded-md border p-3" data-testid="group-single-edit-phases">
              {PHASES.map((p) => (
                <div key={p.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`single-edit-phase-${p.value}`}
                    checked={selectedPhases.has(p.value)}
                    onCheckedChange={(checked) => togglePhase(p.value, checked === true)}
                    data-testid={`checkbox-single-edit-phase-${p.value}`}
                  />
                  <Label
                    htmlFor={`single-edit-phase-${p.value}`}
                    className="font-normal cursor-pointer"
                  >
                    {p.label}
                  </Label>
                </div>
              ))}
            </div>
          </div>

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

          {conflicts.length > 0 && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1"
              data-testid="list-single-edit-conflicts"
            >
              <div className="flex items-center gap-2 text-destructive font-medium text-sm">
                <AlertTriangle className="h-4 w-4" />
                Existing configurations conflict
              </div>
              <ul className="text-sm text-muted-foreground list-disc pl-5">
                {conflicts.map((c, i) => (
                  <li
                    key={`${c.benefit}-${c.phase}-${i}`}
                    data-testid={`single-edit-conflict-${c.benefit}-${c.phase}`}
                  >
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
            data-testid="button-single-edit-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => submitRef.current?.click()}
            disabled={saving}
            data-testid="button-single-edit-submit"
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      const result = (await apiRequest("POST", `${pluginConfigsUrl(KIND)}/bulk`, {
        pluginId,
        policy: policyId,
        benefits: Array.from(selectedBenefits),
        phases: Array.from(selectedPhases),
        name: name.trim() || null,
        enabled,
        data: validSettings,
        // Combos that already have a configuration are replaced by the new
        // one instead of failing the whole request.
        overwrite: true,
      })) as { created: number; replaced?: number };
      toast({
        title: "Configurations created",
        description:
          result.replaced && result.replaced > 0
            ? `${result.replaced} existing configuration${result.replaced === 1 ? " was" : "s were"} replaced.`
            : undefined,
      });
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
            Combinations that already have a configuration are replaced.
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
  benefits: TrustBenefit[];
  onSaved: () => void;
}

function BulkEditDialog({
  open,
  onOpenChange,
  plugin,
  configIds,
  count,
  benefits,
  onSaved,
}: BulkEditDialogProps) {
  const { toast } = useToast();
  const submitRef = useRef<HTMLButtonElement>(null);

  type EnabledChoice = "no-change" | "enabled" | "disabled";
  type PhasesChoice = "no-change" | "start" | "continue" | "both";

  const PHASES_BY_CHOICE: Record<Exclude<PhasesChoice, "no-change">, string[]> = {
    start: ["start"],
    continue: ["continue"],
    both: ["start", "continue"],
  };

  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [enabledChoice, setEnabledChoice] = useState<EnabledChoice>("no-change");
  const [phasesChoice, setPhasesChoice] = useState<PhasesChoice>("no-change");
  const [saving, setSaving] = useState(false);
  const [conflicts, setConflicts] = useState<{ benefit: string; phase: string }[]>([]);

  const prevOpen = useRef(false);
  if (open && !prevOpen.current) {
    setSettings({});
    setEnabledChoice("no-change");
    setPhasesChoice("no-change");
    setConflicts([]);
  }
  prevOpen.current = open;

  const settingsSchema: JsonSchema =
    plugin?.configSchema ?? { type: "object", properties: {} };

  const benefitName = (id: string): string =>
    benefits.find((b) => b.id === id)?.name ?? id;

  // Whether the user has entered any settings to push. Empty means "leave each
  // config's current settings untouched" — useful for a pure enable/disable.
  const hasSettings = Object.keys(settings).length > 0;
  const nothingToApply =
    !hasSettings && enabledChoice === "no-change" && phasesChoice === "no-change";

  const submit = async (
    validSettings: Record<string, unknown>,
    includeSettings: boolean,
  ) => {
    const enabled =
      enabledChoice === "no-change" ? undefined : enabledChoice === "enabled";
    const phases =
      phasesChoice === "no-change" ? undefined : PHASES_BY_CHOICE[phasesChoice];
    if (!includeSettings && enabled === undefined && phases === undefined) {
      toast({
        title: "Nothing to apply",
        description: "Change the settings, enable/disable, phases, or a combination.",
        variant: "destructive",
      });
      return;
    }
    setConflicts([]);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ids: configIds };
      if (includeSettings) body.data = validSettings;
      if (enabled !== undefined) body.enabled = enabled;
      if (phases !== undefined) body.phases = phases;
      await apiRequest("POST", `${pluginConfigsUrl(KIND)}/bulk-settings`, body);
      toast({ title: "Changes applied", description: `Updated ${count} configuration(s).` });
      onSaved();
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && error.data?.conflicts) {
        setConflicts(error.data.conflicts as { benefit: string; phase: string }[]);
        toast({
          title: "Conflicts found",
          description:
            "Some benefit/phase combinations already have a configuration. Nothing was changed.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to apply changes.",
          variant: "destructive",
        });
      }
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
            Each configuration keeps its own benefit; phases change only if you set them below.
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

          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <Label>Phases</Label>
              <p className="text-sm text-muted-foreground">
                Optionally set the Start/Continue phases on all selected configurations.
              </p>
            </div>
            <Select
              value={phasesChoice}
              onValueChange={(v) => setPhasesChoice(v as PhasesChoice)}
            >
              <SelectTrigger className="w-48" data-testid="select-bulk-edit-phases">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no-change" data-testid="option-bulk-edit-phases-no-change">
                  No change
                </SelectItem>
                <SelectItem value="start" data-testid="option-bulk-edit-phases-start">
                  Start only
                </SelectItem>
                <SelectItem value="continue" data-testid="option-bulk-edit-phases-continue">
                  Continue only
                </SelectItem>
                <SelectItem value="both" data-testid="option-bulk-edit-phases-both">
                  Start + Continue
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

          {conflicts.length > 0 && (
            <div
              className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-1"
              data-testid="list-bulk-edit-conflicts"
            >
              <div className="flex items-center gap-2 text-destructive font-medium text-sm">
                <AlertTriangle className="h-4 w-4" />
                Existing configurations conflict
              </div>
              <ul className="text-sm text-muted-foreground list-disc pl-5">
                {conflicts.map((c, i) => (
                  <li
                    key={`${c.benefit}-${c.phase}-${i}`}
                    data-testid={`bulk-edit-conflict-${c.benefit}-${c.phase}`}
                  >
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
