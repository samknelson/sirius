import { useMemo, useState } from "react";
import type { IChangeEvent } from "@rjsf/core";
import type { UiSchema } from "@rjsf/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Loader2, Play, ShieldAlert, X } from "lucide-react";
import type { JsonSchema } from "@shared/json-schema-form";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SchemaForm } from "@/components/json-schema-form";
import { WcLayout } from "@/components/layouts/WebServicesLayout";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { getApiErrorMessage, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

interface WcRow {
  pluginId: string;
  pluginName: string;
  vendor: string;
  service: string | null;
  requestType: string;
  configurationId: string;
  configurationName?: string | null;
  cached: boolean;
  callsToday: number;
  callsLast7Days: number;
  manualRun?: {
    argsSchema: JsonSchema;
    uiSchema?: UiSchema;
    effect: "read" | "write";
  };
}

const ALL = "all";

export default function WcOverviewPage() {
  usePageTitle("Web Client Providers");

  const { data, isLoading, isError, refetch } = useQuery<WcRow[]>({
    queryKey: ["/api/admin/wc-overview"],
  });
  const [vendor, setVendor] = useState(ALL);
  const [requestType, setRequestType] = useState(ALL);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<WcRow | null>(null);
  const [args, setArgs] = useState<Record<string, unknown>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [forceFresh, setForceFresh] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const run = useMutation({
    mutationFn: ({
      row,
      values,
    }: {
      row: WcRow;
      values: Record<string, unknown>;
    }) =>
      apiRequest(
        "POST",
        `/api/admin/wc-overview/${encodeURIComponent(row.configurationId)}/${encodeURIComponent(row.requestType)}/run`,
        { args: values, confirmedWrite: confirmed, forceFresh },
      ),
    onSuccess: () => {
      // The server's result may be served from cache or the network, and its
      // shape is intentionally vendor-specific. Refresh the registry after
      // every successful run so usage counters never go stale.
      queryClient.invalidateQueries({
        queryKey: ["/api/admin/wc-overview"],
      });
    },
  });

  const rows = data ?? [];
  const vendors = useMemo(
    () => Array.from(new Set(rows.map((row) => row.vendor))).sort(),
    [rows],
  );
  const requestTypes = useMemo(
    () => Array.from(new Set(rows.map((row) => row.requestType))).sort(),
    [rows],
  );
  const filteredRows = rows.filter((row) => {
    const haystack = `${row.pluginName} ${row.pluginId} ${row.service ?? ""} ${row.requestType} ${
      row.configurationName ?? ""
    }`.toLowerCase();
    return (
      (vendor === ALL || row.vendor === vendor) &&
      (requestType === ALL || row.requestType === requestType) &&
      (!search || haystack.includes(search.toLowerCase()))
    );
  });

  const openRun = (row: WcRow) => {
    setSelected(row);
    setArgs({});
    setConfirmed(false);
    setForceFresh(false);
    setValidationError(null);
    run.reset();
  };
  const closeRun = () => {
    if (!run.isPending) {
      setSelected(null);
      setArgs({});
      setConfirmed(false);
      setForceFresh(false);
      setValidationError(null);
      run.reset();
    }
  };
  const clearFilters = () => {
    setVendor(ALL);
    setRequestType(ALL);
    setSearch("");
  };

  return (
    <WcLayout activeTab="wc-overview">
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold">Provider operations</h2>
          <p className="text-sm text-muted-foreground">
            See which configured provider supplies each request type and safely
            run supported operations. Teamsters 631 worker dry-runs, imports, and synchronization
            remain on the{" "}
            <Link href="/config/edls/t631-fetch" className="underline underline-offset-4">
              Teamsters 631 Sync
            </Link>{" "}
            page.
          </p>
        </div>

        <Card data-testid="card-wc-filters">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-52 flex-1 space-y-1">
                <Label htmlFor="wc-search">Search</Label>
                <Input
                  id="wc-search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Provider, plugin, service, configuration…"
                  data-testid="input-wc-search"
                />
              </div>
              <div className="w-48 space-y-1">
                <Label>Provider</Label>
                <Select value={vendor} onValueChange={setVendor}>
                  <SelectTrigger data-testid="select-wc-vendor">
                    <SelectValue placeholder="All providers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All providers</SelectItem>
                    {vendors.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-56 space-y-1">
                <Label>Request type</Label>
                <Select value={requestType} onValueChange={setRequestType}>
                  <SelectTrigger data-testid="select-wc-request">
                    <SelectValue placeholder="All request types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All request types</SelectItem>
                    {requestTypes.map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(vendor !== ALL || requestType !== ALL || search) && (
                <Button
                  variant="ghost"
                  onClick={clearFilters}
                  data-testid="button-clear-wc-filters"
                >
                  <X className="mr-2 h-4 w-4" />
                  Clear
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {isLoading ? (
          <Card>
            <CardContent className="space-y-3 py-8">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-4 animate-pulse rounded bg-muted" />
              ))}
            </CardContent>
          </Card>
        ) : isError ? (
          <Alert variant="destructive">
            <AlertDescription className="flex items-center justify-between gap-4">
              Couldn’t load provider operations.
              <Button variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : filteredRows.length === 0 ? (
          <Card>
            <CardContent
              className="py-12 text-center text-sm text-muted-foreground"
              data-testid="text-wc-empty"
            >
              No provider operations match these filters.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table data-testid="table-wc-overview">
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Request type</TableHead>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Cached?</TableHead>
                  <TableHead>Calls today</TableHead>
                  <TableHead>Calls last 7 days</TableHead>
                  <TableHead className="text-right">Run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((row) => (
                  <TableRow
                    key={`${row.configurationId}-${row.requestType}`}
                    data-testid={`row-wc-${row.configurationId}-${row.requestType}`}
                  >
                    <TableCell>
                      <div className="font-medium">{row.pluginName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {row.pluginId}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.requestType}
                    </TableCell>
                    <TableCell>
                      {row.configurationName || "[no name]"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={row.cached ? "secondary" : "outline"}>
                        {row.cached ? "Yes" : "No"}
                      </Badge>
                    </TableCell>
                    <TableCell>{row.callsToday ?? 0}</TableCell>
                    <TableCell>{row.callsLast7Days ?? 0}</TableCell>
                    <TableCell className="text-right">
                      {row.manualRun ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => openRun(row)}
                          data-testid={`button-run-wc-${row.configurationId}-${row.requestType}`}
                        >
                          <Play className="mr-1.5 h-3.5 w-3.5" />
                          Run
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && closeRun()}>
        <DialogContent
          className="max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl overflow-y-auto"
          data-testid="dialog-wc-run"
        >
          {selected?.manualRun && (
            <>
              <DialogHeader>
                <DialogTitle>Run {selected.requestType}</DialogTitle>
                <DialogDescription>
                  {selected.vendor} · {selected.configurationName || "[no name]"} ·{" "}
                  {selected.manualRun.effect === "write"
                    ? "Write operation"
                    : "Read operation"}
                </DialogDescription>
              </DialogHeader>

              <div className="grid min-h-0 gap-6 md:grid-cols-2">
                <div className="min-w-0 space-y-4">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Arguments</CardTitle>
                    </CardHeader>
                    <CardContent>
                      {validationError && (
                        <Alert
                          variant="destructive"
                          className="mb-4"
                          data-testid="alert-wc-validation"
                        >
                          <AlertDescription>{validationError}</AlertDescription>
                        </Alert>
                      )}
                      <SchemaForm
                        schema={selected.manualRun.argsSchema}
                        uiSchema={selected.manualRun.uiSchema}
                        formData={args}
                        onChange={(
                          event: IChangeEvent<Record<string, unknown>>,
                        ) => {
                          setValidationError(null);
                          setArgs(event.formData ?? {});
                        }}
                        onError={(errors) => {
                          setValidationError(
                            errors.length === 1
                              ? "Please correct the highlighted field before running."
                              : `Please correct the ${errors.length} highlighted fields before running.`,
                          );
                        }}
                        onSubmit={(
                          event: IChangeEvent<Record<string, unknown>>,
                        ) =>
                          run.mutate({
                            row: selected,
                            values: event.formData ?? {},
                          })
                        }
                      >
                        <Button
                          type="submit"
                          disabled={
                            run.isPending ||
                            (selected.manualRun.effect === "write" && !confirmed)
                          }
                          data-testid="button-confirm-wc-run"
                        >
                          {run.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="mr-2 h-4 w-4" />
                          )}
                          Run operation
                        </Button>
                      </SchemaForm>
                    </CardContent>
                  </Card>

                  {selected.manualRun.effect === "write" && (
                    <Alert variant="destructive">
                      <ShieldAlert className="h-4 w-4" />
                      <AlertDescription>
                        <strong>This changes remote data.</strong>
                        <label className="mt-3 flex items-start gap-2">
                          <Checkbox
                            checked={confirmed}
                            onCheckedChange={(value) =>
                              setConfirmed(value === true)
                            }
                            data-testid="checkbox-confirm-wc-write"
                          />
                          <span>
                            I understand this operation may mutate the vendor
                            account.
                          </span>
                        </label>
                      </AlertDescription>
                    </Alert>
                  )}

                  {selected.cached ? (
                    <Alert>
                      <AlertDescription>
                        <label className="flex items-start gap-2">
                          <Checkbox
                            checked={forceFresh}
                            onCheckedChange={(value) =>
                              setForceFresh(value === true)
                            }
                            data-testid="checkbox-force-fresh-wc-run"
                          />
                          <span>
                            <strong>Call the provider instead of using cache.</strong>
                            <span className="mt-1 block text-muted-foreground">
                              {forceFresh
                                ? "The next run will request a fresh answer from the provider."
                                : "The next run may use a recent cached answer."}
                            </span>
                          </span>
                        </label>
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <p
                      className="text-sm text-muted-foreground"
                      data-testid="text-wc-run-uncached"
                    >
                      This operation does not use cached answers; each run calls
                      the provider.
                    </p>
                  )}
                </div>

                <Card className="min-w-0">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Eye className="h-4 w-4" />
                      Full result
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {run.isPending && (
                      <div className="space-y-2" data-testid="wc-result-loading">
                        <div className="h-4 animate-pulse rounded bg-muted" />
                        <div className="h-4 animate-pulse rounded bg-muted" />
                      </div>
                    )}
                    {run.isError && (
                      <Alert variant="destructive">
                        <AlertDescription>
                          {getApiErrorMessage(run.error, "The operation failed.")}
                        </AlertDescription>
                      </Alert>
                    )}
                    {run.data !== undefined && (
                      <pre
                        className="max-h-[55vh] overflow-auto rounded-md bg-muted p-4 text-xs"
                        data-testid="text-wc-result"
                      >
                        {JSON.stringify(run.data, null, 2)}
                      </pre>
                    )}
                    {!run.isPending && !run.isError && run.data === undefined && (
                      <p className="text-sm text-muted-foreground">
                        Run an operation to inspect its cache, source, and
                        response details.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </WcLayout>
  );
}