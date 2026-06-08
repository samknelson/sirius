import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useQueries, useMutation, keepPreviousData } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  pluginManifestQueryKey,
  pluginConfigsQueryKey,
  pluginConfigsUrl,
  pluginConfigsMetaQueryKey,
  pluginKindsQueryKey,
  pluginSearch,
  type ArrayManifestPluginKind,
  type PluginConfigEnvelopeField,
  type PluginKindSummary,
} from "@/plugins/_core";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import {
  Loader2,
  Plus,
  Settings,
  Trash2,
  ChevronDown,
  X,
  Info,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ArrowLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { JsonSchema } from "@shared/json-schema-form";
import type { IChangeEvent } from "@rjsf/core";
import type { UiSchema } from "@rjsf/utils";
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

// Kinds the unified generic config routes actually serve. `charge` was cut
// over to the unified plugin_configs tables in Task #355 and is served here via
// the "Charge Plugins" nav entry (/admin/plugin-configs/charge). The
// relational kinds (`charge`, `trust-eligibility`, `dispatch-eligibility`)
// carry envelope fields; `dashboard` has none.
const ALLOWED_KINDS: ArrayManifestPluginKind[] = [
  "charge",
  "client-injection",
  "dashboard",
  "dispatch-eligibility",
  "payment-gateway",
  "trust-eligibility",
];

interface ManifestEntry {
  id: string;
  name: string;
  description?: string;
  configSchema?: JsonSchema;
  uiSchema?: UiSchema;
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

type SortDirection = "asc" | "desc";

// Reserved (non-field) sortable column ids. Dynamic filterable columns use
// `field:<envelopeFieldName>` so they never collide with these.
const SORT_PLUGIN = "plugin";
const SORT_NAME = "name";
const SORT_ENABLED = "enabled";
const SORT_ORDER = "order";
const SORT_SIRIUS_ID = "siriusId";

/** Derive a human-readable name from a kind id (e.g. "trust-eligibility" → "Trust Eligibility"). Mirrors the server fallback. */
function prettifyKind(kind: string): string {
  return kind
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export default function GenericPluginConfigsPage() {
  const params = useParams<{ kind: string }>();
  const kind = params.kind as ArrayManifestPluginKind;
  const isValidKind = ALLOWED_KINDS.includes(kind);

  const { data: kinds = [] } = useQuery<PluginKindSummary[]>({
    queryKey: pluginKindsQueryKey(),
    enabled: isValidKind,
  });
  const kindSummary = kinds.find((k) => k.kind === kind);
  // Fall back to a prettified id when the kinds index has no match yet
  // (loading) or omits this kind, so the page never shows the raw id.
  const kindName = kindSummary?.label ?? prettifyKind(kind);
  const kindDescription = kindSummary?.description;

  usePageTitle(`Plugin Configs - ${kindName}`);
  const { toast } = useToast();

  const [dialogPlugin, setDialogPlugin] = useState<ManifestEntry | null>(null);
  const [dialogConfig, setDialogConfig] = useState<PluginConfigRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Active filter values keyed by field name (plus the universal "pluginId").
  // Empty string means "no filter on this field".
  const [filters, setFilters] = useState<Record<string, string>>({});

  // Active column sort. `null` keeps the default ordering (plugin name, then
  // order). Column ids are the reserved keys below or `field:<envelopeFieldName>`
  // for the dynamic filterable columns.
  const [sort, setSort] = useState<{ column: string; direction: SortDirection } | null>(null);

  const { data: plugins = [], isLoading: isLoadingPlugins } = useQuery<ManifestEntry[]>({
    queryKey: pluginManifestQueryKey(kind),
    enabled: isValidKind,
  });

  const { data: meta } = useQuery<{ envelopeFields: PluginConfigEnvelopeField[] }>({
    queryKey: pluginConfigsMetaQueryKey(kind),
    enabled: isValidKind,
  });
  const envelopeFields = meta?.envelopeFields ?? [];
  const filterableFields = envelopeFields.filter((f) => f.filterable);

  // Drop empty selections so an unset filter contributes no search condition.
  const searchParams: Record<string, string> = {};
  for (const [name, value] of Object.entries(filters)) {
    if (value) searchParams[name] = value;
  }
  const hasActiveFilters = Object.keys(searchParams).length > 0;

  const { data: configs = [], isLoading: isLoadingConfigs } = useQuery<PluginConfigRow[]>({
    // With no filters we hit the plain list endpoint so the unfiltered view
    // matches the legacy behavior exactly — including any base rows without a
    // subsidiary, which the relational search join would otherwise omit. Only
    // when a filter is set do we switch to the unified POST search.
    queryKey: hasActiveFilters
      ? [...pluginConfigsQueryKey(kind), "search", searchParams]
      : pluginConfigsQueryKey(kind),
    // Always supply an explicit fetcher. We must NOT fall back to
    // `queryFn: undefined` for the unfiltered case: passing it explicitly
    // overwrites the app-wide default fetcher during option merging, leaving the
    // query with no fetcher so it never requests the list and the page wrongly
    // shows "No configurations yet" until a filter is selected.
    queryFn: hasActiveFilters
      ? () => pluginSearch<ArrayManifestPluginKind, PluginConfigRow>(kind, searchParams as any)
      : () => apiRequest("GET", pluginConfigsUrl(kind)) as Promise<PluginConfigRow[]>,
    enabled: isValidKind,
    // Keep the previous results visible while a filter change refetches so the
    // page doesn't flash the full-page loading spinner on every selection.
    placeholderData: keepPreviousData,
  });

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

  const labelMaps = useEnvelopeLabelMaps(envelopeFields);

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
  const pluginById = new Map(sortedPlugins.map((p) => [p.id, p]));
  // Stable default ordering used as the base view and as the tiebreaker for
  // every column sort: plugin name, then order.
  const defaultCompare = (a: PluginConfigRow, b: PluginConfigRow) => {
    const byPlugin = pluginById
      .get(a.pluginId)!
      .name.localeCompare(pluginById.get(b.pluginId)!.name);
    if (byPlugin !== 0) return byPlugin;
    return (a.ordering ?? 0) - (b.ordering ?? 0);
  };

  // Flatten configs into table rows (one per config). Configs whose plugin is
  // missing from the manifest are dropped.
  const rows = configs
    .filter((c) => pluginById.has(c.pluginId))
    .sort(defaultCompare);

  // The comparable value for a config in a given column, using the value the
  // user actually sees (resolved labels for relational columns).
  const getSortValue = (
    config: PluginConfigRow,
    column: string,
  ): string | number | boolean => {
    if (column === SORT_PLUGIN) return pluginById.get(config.pluginId)?.name ?? "";
    if (column === SORT_NAME) return config.name ?? "";
    if (column === SORT_ENABLED) return config.enabled;
    if (column === SORT_ORDER) return config.ordering ?? 0;
    if (column === SORT_SIRIUS_ID) {
      const sid = config.siriusId;
      return sid === null || sid === undefined ? "" : String(sid);
    }
    const fieldName = column.startsWith("field:") ? column.slice("field:".length) : column;
    const value = config[fieldName];
    if (value === null || value === undefined || value === "") return "";
    const fieldMeta = labelMaps.get(fieldName);
    return fieldMeta ? fieldMeta.resolve(value) : String(value);
  };

  // Sort the (already filtered, default-ordered) rows by the active column.
  // Empty values are always grouped at the end; equal values fall back to the
  // default ordering so rows never shuffle arbitrarily.
  const sortedRows = sort
    ? [...rows].sort((a, b) => {
        const av = getSortValue(a, sort.column);
        const bv = getSortValue(b, sort.column);
        const aEmpty = av === "";
        const bEmpty = bv === "";
        if (aEmpty && bEmpty) return defaultCompare(a, b);
        if (aEmpty) return 1;
        if (bEmpty) return -1;
        let cmp: number;
        if (typeof av === "number" && typeof bv === "number") {
          cmp = av - bv;
        } else if (typeof av === "boolean" && typeof bv === "boolean") {
          cmp = av === bv ? 0 : av ? 1 : -1;
        } else {
          cmp = String(av).localeCompare(String(bv));
        }
        if (sort.direction === "desc") cmp = -cmp;
        return cmp !== 0 ? cmp : defaultCompare(a, b);
      })
    : rows;

  const toggleSort = (column: string) =>
    setSort((prev) =>
      prev?.column === column
        ? { column, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { column, direction: "asc" },
    );

  const updateFilter = (name: string, value: string) =>
    setFilters((prev) => ({ ...prev, [name]: value }));
  const clearFilters = () => setFilters({});

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <Link href="/admin/plugin-configs">
        <Button variant="ghost" size="sm" className="-ml-2" data-testid="button-back-to-plugin-configs">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Plugin Configs
        </Button>
      </Link>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
            {`Plugin Configs - ${kindName}`}
          </h1>
          {kindDescription && (
            <p className="text-muted-foreground mt-2" data-testid="text-page-description">
              {kindDescription}
            </p>
          )}
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

      {sortedPlugins.length > 0 && (
        <FilterBar
          filterableFields={filterableFields}
          plugins={sortedPlugins}
          filters={filters}
          onChange={updateFilter}
          onClear={clearFilters}
        />
      )}

      {sortedPlugins.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground" data-testid="text-empty-manifest">
              No plugins available for this kind.
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            {hasActiveFilters ? (
              <p className="text-center text-muted-foreground" data-testid="text-empty-filtered">
                No configurations match the current filters.
              </p>
            ) : (
              <p className="text-center text-muted-foreground" data-testid="text-empty-configs">
                No configurations yet. Use “New Configuration” above to add one.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table data-testid="table-plugin-configs">
            <TableHeader>
              <TableRow>
                <SortableHead columnId={SORT_PLUGIN} label="Plugin" sort={sort} onToggle={toggleSort} />
                <SortableHead columnId={SORT_NAME} label="Name" sort={sort} onToggle={toggleSort} />
                {filterableFields.map((field) => (
                  <SortableHead
                    key={field.name}
                    columnId={`field:${field.name}`}
                    label={field.label}
                    sort={sort}
                    onToggle={toggleSort}
                  />
                ))}
                <SortableHead columnId={SORT_ENABLED} label="Enabled?" sort={sort} onToggle={toggleSort} />
                <SortableHead columnId={SORT_ORDER} label="Order" sort={sort} onToggle={toggleSort} />
                <SortableHead columnId={SORT_SIRIUS_ID} label="Sirius ID" sort={sort} onToggle={toggleSort} />
                <TableHead className="text-right">Tools</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedRows.map((config) => {
                const plugin = pluginById.get(config.pluginId)!;
                return (
                  <TableRow key={config.id} data-testid={`row-config-${config.id}`}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-medium"
                          data-testid={`text-plugin-name-${config.id}`}
                        >
                          {plugin.name}
                        </span>
                        {plugin.description && <PluginInfoPopover plugin={plugin} configId={config.id} />}
                      </div>
                    </TableCell>
                    <TableCell data-testid={`text-config-name-${config.id}`}>
                      {config.name || "—"}
                    </TableCell>
                    {filterableFields.map((field) => {
                      const fieldMeta = labelMaps.get(field.name);
                      const value = config[field.name];
                      const display =
                        value === null || value === undefined || value === ""
                          ? "—"
                          : fieldMeta
                          ? fieldMeta.resolve(value)
                          : String(value);
                      return (
                        <TableCell
                          key={field.name}
                          data-testid={`cell-${field.name}-${config.id}`}
                        >
                          {display}
                        </TableCell>
                      );
                    })}
                    <TableCell>
                      <Badge variant={config.enabled ? "default" : "secondary"}>
                        {config.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </TableCell>
                    <TableCell data-testid={`text-order-${config.id}`}>
                      {config.ordering}
                    </TableCell>
                    <TableCell data-testid={`text-sirius-id-${config.id}`}>
                      {config.siriusId === null || config.siriusId === undefined
                        ? "—"
                        : String(config.siriusId)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
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
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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

/**
 * Filter bar for the generic config list. Renders a universal "Plugin" dropdown
 * (sourced from the kind's manifest) plus one dropdown per field the kind marked
 * `filterable` in its adapter metadata. Selections drive the unified search;
 * nothing here is kind-specific — a kind gains filters by flagging its fields.
 */
function FilterBar({
  filterableFields,
  plugins,
  filters,
  onChange,
  onClear,
}: {
  filterableFields: PluginConfigEnvelopeField[];
  plugins: ManifestEntry[];
  filters: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onClear: () => void;
}) {
  // Synthesize the universal Plugin filter as an envelope field so it renders
  // through the same dropdown control as the relational filters.
  const pluginField: PluginConfigEnvelopeField = {
    name: "pluginId",
    label: "Plugin",
    type: "string",
    options: {
      choices: plugins.map((p) => ({ value: p.id, label: p.name })),
    },
  };
  const controls = [pluginField, ...filterableFields];
  const hasActive = Object.values(filters).some((v) => v);

  return (
    <Card data-testid="card-filters">
      <CardContent className="pt-6">
        <div className="flex flex-wrap items-end gap-4">
          {controls.map((field) => (
            <div className="space-y-1 min-w-[12rem]" key={field.name}>
              <Label>{field.label}</Label>
              {field.options ? (
                <EnvelopeSelectField
                  field={field}
                  value={filters[field.name] ?? ""}
                  onChange={(value) => onChange(field.name, value)}
                  testIdPrefix="filter"
                />
              ) : (
                // Defensive fallback: a field can be flagged `filterable`
                // without `options` metadata. Render a free-text filter rather
                // than crashing EnvelopeSelectField (which assumes options).
                <Input
                  type={field.type === "number" ? "number" : "text"}
                  placeholder="Filter…"
                  value={filters[field.name] ?? ""}
                  onChange={(e) => onChange(field.name, e.target.value)}
                  data-testid={`input-filter-${field.name}`}
                />
              )}
            </div>
          ))}
          {hasActive && (
            <Button variant="ghost" onClick={onClear} data-testid="button-clear-filters">
              <X className="mr-2 h-4 w-4" />
              Clear filters
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Resolves relational envelope-field values to human-friendly labels using the
 * same `options` metadata that drives the edit-form dropdowns. Static-choice
 * fields (e.g. scope) map locally; endpoint-backed fields (e.g. employer,
 * account) fetch their source once and build an id→label map. The result is a
 * lookup keyed by field name: `{ label, resolve(value) }`.
 */
function useEnvelopeLabelMaps(envelopeFields: PluginConfigEnvelopeField[]) {
  const endpointFields = envelopeFields.filter(
    (f) => f.options?.endpoint && !f.options.choices,
  );

  const results = useQueries({
    queries: endpointFields.map((f) => ({
      queryKey: [f.options!.endpoint!],
      enabled: !!f.options!.endpoint,
    })),
  });

  const byField = new Map<
    string,
    { label: string; resolve: (value: unknown) => string }
  >();

  for (const field of envelopeFields) {
    const options = field.options;
    if (!options) continue;

    if (Array.isArray(options.choices)) {
      const map = new Map(options.choices.map((c) => [c.value, c.label]));
      byField.set(field.name, {
        label: field.label,
        // Multi-value fields store a comma-joined string (e.g. "start,continue");
        // single-value fields store one token. Split-map-join handles both since
        // a lone value has no comma.
        resolve: (value) =>
          String(value)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
            .map((v) => map.get(v) ?? v)
            .join(", "),
      });
      continue;
    }

    if (options.endpoint) {
      const idx = endpointFields.indexOf(field);
      const rows = (results[idx]?.data as Record<string, unknown>[] | undefined) ?? [];
      const map = new Map(
        rows.map((row) => [
          String(row[options.valueKey!] ?? ""),
          String(row[options.labelKey!] ?? ""),
        ]),
      );
      byField.set(field.name, {
        label: field.label,
        resolve: (value) => {
          const key = String(value);
          return map.get(key) || key;
        },
      });
    }
  }

  return byField;
}

/**
 * Small info trigger shown beside a plugin's name in the table. Opens a popover
 * with the plugin's manifest description so the description doesn't have to sit
 * inline in every row. Only rendered when the plugin has a description.
 */
function PluginInfoPopover({
  plugin,
  configId,
}: {
  plugin: ManifestEntry;
  configId: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground"
          aria-label={`About ${plugin.name}`}
          data-testid={`button-plugin-info-${configId}`}
        >
          <Info className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="max-w-xs text-sm"
        data-testid={`popover-plugin-info-${configId}`}
      >
        <p className="font-medium mb-1">{plugin.name}</p>
        <p className="text-muted-foreground">{plugin.description}</p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A clickable table header that toggles sorting for its column. Shows a
 * neutral up/down icon when inactive and the active direction otherwise.
 */
function SortableHead({
  columnId,
  label,
  sort,
  onToggle,
  className,
}: {
  columnId: string;
  label: string;
  sort: { column: string; direction: SortDirection } | null;
  onToggle: (column: string) => void;
  className?: string;
}) {
  const active = sort?.column === columnId;
  const Icon = active ? (sort!.direction === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <TableHead
      className={className}
      aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onToggle(columnId)}
        className="flex items-center gap-1 hover:text-foreground"
        aria-label={`Sort by ${label}`}
        data-testid={`sort-${columnId.replace(":", "-")}`}
      >
        {label}
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            active ? "text-foreground" : "text-muted-foreground/50",
          )}
        />
      </button>
    </TableHead>
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
  const settingsUiSchema = plugin.uiSchema;

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [ordering, setOrdering] = useState(0);
  const [siriusId, setSiriusId] = useState("");
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [envelope, setEnvelope] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    if (config) {
      setName(config.name ?? "");
      setEnabled(config.enabled);
      setOrdering(config.ordering ?? 0);
      setSiriusId(
        config.siriusId === null || config.siriusId === undefined
          ? ""
          : String(config.siriusId),
      );
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
      setSiriusId("");
      setSettings({});
      setEnvelope(Object.fromEntries(envelopeFields.map((f) => [f.name, ""])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, config]);

  const handleSubmit = (validSettings: Record<string, unknown>) => {
    // Block save if any required envelope field is empty (client-side mirror of
    // the server-side adapter validation, e.g. charge's required account).
    const missing = envelopeFields.find(
      (f) => f.required && !(envelope[f.name] ?? "").trim(),
    );
    if (missing) {
      toast({
        title: "Missing required field",
        description: `${missing.label} is required.`,
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate(validSettings);
  };

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
        siriusId: siriusId.trim() || null,
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

            <div className="space-y-1">
              <Label>Sirius ID</Label>
              <Input
                placeholder="Optional unique identifier"
                value={siriusId}
                onChange={(e) => setSiriusId(e.target.value)}
                data-testid="input-sirius-id"
              />
              <p className="text-xs text-muted-foreground">
                Optional, unique, stable identifier. Component-owned rows manage
                this automatically — leave blank for manual configs.
              </p>
            </div>

            {envelopeFields.length > 0 && (
              <div className="grid grid-cols-2 gap-4" data-testid="envelope-fields">
                {envelopeFields.map((field) => (
                  <div className="space-y-1" key={field.name}>
                    <Label>
                      {field.label}
                      {field.required && <span className="text-destructive"> *</span>}
                    </Label>
                    {field.multiple && field.options?.choices ? (
                      <EnvelopeCheckboxField
                        field={field}
                        value={envelope[field.name] ?? ""}
                        onChange={(value) =>
                          setEnvelope((prev) => ({ ...prev, [field.name]: value }))
                        }
                      />
                    ) : field.options ? (
                      <EnvelopeSelectField
                        field={field}
                        value={envelope[field.name] ?? ""}
                        onChange={(value) =>
                          setEnvelope((prev) => ({ ...prev, [field.name]: value }))
                        }
                      />
                    ) : (
                      <Input
                        type={field.type === "number" ? "number" : "text"}
                        placeholder={field.required ? "Required" : "Optional"}
                        value={envelope[field.name] ?? ""}
                        onChange={(e) =>
                          setEnvelope((prev) => ({ ...prev, [field.name]: e.target.value }))
                        }
                        data-testid={`input-envelope-${field.name}`}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <SchemaForm
              schema={settingsSchema}
              uiSchema={settingsUiSchema}
              formData={settings}
              showErrorList="top"
              onChange={(e: IChangeEvent) => setSettings(e.formData as Record<string, unknown>)}
              onSubmit={(e: IChangeEvent) => handleSubmit(e.formData as Record<string, unknown>)}
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

/**
 * Renders a relational envelope field as a dropdown populated from the remote
 * data source declared in the field's `options` metadata. Generic: the endpoint
 * and the value/label keys all come from the adapter metadata, so no field is
 * hardcoded here.
 */
function EnvelopeSelectField({
  field,
  value,
  onChange,
  testIdPrefix = "envelope",
}: {
  field: PluginConfigEnvelopeField;
  value: string;
  onChange: (value: string) => void;
  testIdPrefix?: string;
}) {
  const options = field.options!;
  const isStatic = Array.isArray(options.choices);
  // Only hit the endpoint when this field is endpoint-backed (static choices
  // need no fetch). queryKey still needs a stable value, so fall back to a
  // dummy key with the query disabled.
  const { data = [], isLoading } = useQuery<Record<string, unknown>[]>({
    queryKey: [options.endpoint ?? `__static__${field.name}`],
    enabled: !isStatic && !!options.endpoint,
  });

  // Normalize both sources to a flat {value,label} list.
  const items: { value: string; label: string }[] = isStatic
    ? options.choices!.map((c) => ({ value: c.value, label: c.label }))
    : data.map((item) => {
        const itemValue = String(item[options.valueKey!] ?? "");
        return { value: itemValue, label: String(item[options.labelKey!] ?? itemValue) };
      });

  // Sentinel for the "clear selection" item — Radix SelectItem forbids an
  // empty-string value, so optional fields use this and map it back to "".
  const NONE = "__none__";

  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => onChange(v === NONE ? "" : v)}
    >
      <SelectTrigger data-testid={`select-${testIdPrefix}-${field.name}`}>
        <SelectValue placeholder={isLoading ? "Loading…" : "Select…"} />
      </SelectTrigger>
      <SelectContent>
        {!field.required && (
          <SelectItem value={NONE} data-testid={`option-${testIdPrefix}-${field.name}-none`}>
            None
          </SelectItem>
        )}
        {items.map((item) => (
          <SelectItem
            key={item.value}
            value={item.value}
            data-testid={`option-${testIdPrefix}-${field.name}-${item.value}`}
          >
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * Renders a fixed-choice envelope field as a checkbox group allowing multiple
 * selections. The value is stored as a comma-joined string of selected choice
 * values (e.g. "start,continue") so it round-trips through the flat envelope
 * state and the adapter's `string` payload field unchanged.
 */
function EnvelopeCheckboxField({
  field,
  value,
  onChange,
}: {
  field: PluginConfigEnvelopeField;
  value: string;
  onChange: (value: string) => void;
}) {
  const choices = field.options!.choices ?? [];
  const selected = new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const toggle = (choiceValue: string, checked: boolean) => {
    const next = new Set(selected);
    if (checked) {
      next.add(choiceValue);
    } else {
      next.delete(choiceValue);
    }
    // Preserve the declared choice order when re-joining.
    onChange(
      choices
        .map((c) => c.value)
        .filter((v) => next.has(v))
        .join(","),
    );
  };

  return (
    <div className="space-y-2 pt-1" data-testid={`checkbox-group-envelope-${field.name}`}>
      {choices.map((choice) => (
        <div key={choice.value} className="flex items-center gap-2">
          <Checkbox
            id={`envelope-${field.name}-${choice.value}`}
            checked={selected.has(choice.value)}
            onCheckedChange={(checked) => toggle(choice.value, checked === true)}
            data-testid={`checkbox-envelope-${field.name}-${choice.value}`}
          />
          <Label
            htmlFor={`envelope-${field.name}-${choice.value}`}
            className="font-normal cursor-pointer"
          >
            {choice.label}
          </Label>
        </div>
      ))}
    </div>
  );
}
