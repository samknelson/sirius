import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WcLayout } from "@/components/layouts/WebServicesLayout";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { ApiError, apiRequest } from "@/lib/queryClient";

interface WcConfiguration {
  id: string;
  pluginId: string;
  pluginName: string;
  name: string | null;
  siriusId: string | number | null;
  canTest: boolean;
}

interface ConnectionTest {
  status?: "connected" | "misconfigured" | "unreachable" | "unsupported";
  connected?: boolean;
  account?: {
    id: string;
    email?: string | null;
    country?: string | null;
    defaultCurrency?: string | null;
    type?: string | null;
    capabilities?: { label: string; enabled: boolean }[];
  };
  balances?: { label: string; amount: number; currency: string }[];
  testMode?: boolean;
  error?: { message: string; type?: string; code?: string };
}

type CheckState =
  | { state: "checking" }
  | { state: "ok"; details: ConnectionTest }
  | { state: "error"; message: string; details?: unknown };

const CHECK_ALL_CONCURRENCY = 4;

function configurationLabel(configuration: WcConfiguration): string {
  if (configuration.name?.trim()) return configuration.name;
  if (configuration.siriusId !== null && configuration.siriusId !== undefined) {
    return String(configuration.siriusId);
  }
  return "[no name or Sirius ID]";
}

function errorResult(error: unknown): Extract<CheckState, { state: "error" }> {
  if (error instanceof ApiError) {
    const details = error.data;
    const nestedMessage = details?.error?.message;
    return {
      state: "error",
      message:
        (typeof nestedMessage === "string" && nestedMessage) ||
        (typeof details?.message === "string" && details.message) ||
        error.message.replace(/^\d{3}:\s*/, "") ||
        "Connection check failed",
      details,
    };
  }
  return {
    state: "error",
    message: error instanceof Error ? error.message : "Connection check failed",
  };
}

function ResultDetails({ result }: { result: CheckState }) {
  if (result.state === "checking") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Checking…
      </span>
    );
  }

  if (result.state === "error") {
    const errorDetails = result.details as
      | { error?: { type?: unknown; code?: unknown } }
      | undefined;
    return (
      <div className="space-y-1">
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          error
        </Badge>
        <div className="max-w-xl break-words text-xs text-muted-foreground">
          {result.message}
          {errorDetails?.error?.type
            ? ` · ${String(errorDetails.error.type)}`
            : ""}
          {errorDetails?.error?.code
            ? ` · ${String(errorDetails.error.code)}`
            : ""}
        </div>
      </div>
    );
  }

  const details = result.details;
  return (
    <div className="space-y-1.5">
      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" />
        ok
      </Badge>
      <div className="max-w-xl space-y-0.5 text-xs text-muted-foreground">
        {details.account && (
          <div>
            Account: {details.account.id}
            {details.account.email ? ` · ${details.account.email}` : ""}
            {details.account.country ? ` · ${details.account.country}` : ""}
            {details.account.type ? ` · ${details.account.type}` : ""}
          </div>
        )}
        {details.account?.capabilities?.map((capability) => (
          <div key={capability.label}>
            {capability.label}: {capability.enabled ? "Enabled" : "Disabled"}
          </div>
        ))}
        {details.testMode !== undefined && (
          <div>Mode: {details.testMode ? "Test" : "Live"}</div>
        )}
        {details.balances?.map((balance) => (
          <div key={`${balance.label}-${balance.currency}`}>
            {balance.label}: {balance.amount} {balance.currency.toUpperCase()}
          </div>
        ))}
        {!details.account && details.testMode === undefined && !details.balances?.length && (
          <div>Connection completed successfully.</div>
        )}
      </div>
    </div>
  );
}

export default function WcStatusPage() {
  usePageTitle("Outgoing Web Services Status");
  const { data, isLoading, isError, refetch } = useQuery<WcConfiguration[]>({
    queryKey: ["/api/wc-vendors"],
  });
  const [results, setResults] = useState<Record<string, CheckState>>({});
  const [bulkChecking, setBulkChecking] = useState(false);
  const runVersions = useRef<Record<string, number>>({});
  const bulkCheckingRef = useRef(false);

  const configurations = (data ?? []).filter((configuration) => configuration.canTest);
  const anyChecking = configurations.some(
    (configuration) => results[configuration.id]?.state === "checking",
  );

  const checkConnection = async (configuration: WcConfiguration) => {
    const version = (runVersions.current[configuration.id] ?? 0) + 1;
    runVersions.current[configuration.id] = version;
    setResults((current) => ({
      ...current,
      [configuration.id]: { state: "checking" },
    }));

    try {
      const details = await apiRequest(
        "GET",
        `/api/wc-vendors/${encodeURIComponent(configuration.id)}/test`,
      ) as ConnectionTest;
      const state: CheckState =
        details.status === "connected" || details.connected === true
          ? { state: "ok", details }
          : {
              state: "error",
              message: details.error?.message ?? `Connection status: ${details.status ?? "unknown"}`,
              details,
            };
      if (runVersions.current[configuration.id] === version) {
        setResults((current) => ({ ...current, [configuration.id]: state }));
      }
    } catch (error) {
      if (runVersions.current[configuration.id] === version) {
        setResults((current) => ({
          ...current,
          [configuration.id]: errorResult(error),
        }));
      }
    }
  };

  const checkAll = async () => {
    if (bulkCheckingRef.current) return;
    bulkCheckingRef.current = true;
    setBulkChecking(true);
    const batch = [...configurations];
    let next = 0;
    try {
      const workers = Array.from(
        { length: Math.min(CHECK_ALL_CONCURRENCY, batch.length) },
        async () => {
          while (next < batch.length) {
            const configuration = batch[next++];
            await checkConnection(configuration);
          }
        },
      );
      await Promise.allSettled(workers);
    } finally {
      bulkCheckingRef.current = false;
      setBulkChecking(false);
    }
  };

  return (
    <WcLayout activeTab="wc-status">
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Connection status</h2>
            <p className="text-sm text-muted-foreground">
              Check whether each enabled outgoing service can authenticate and respond.
            </p>
          </div>
          <Button
            onClick={checkAll}
            disabled={configurations.length === 0 || anyChecking || bulkChecking}
            data-testid="button-check-all-wc"
          >
            {anyChecking || bulkChecking ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Check All
          </Button>
        </div>

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
              Couldn’t load enabled webclient configurations.
              <Button variant="outline" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : configurations.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No enabled webclient configurations are available.
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table data-testid="table-wc-status">
              <TableHeader>
                <TableRow>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Configuration</TableHead>
                  <TableHead>Result</TableHead>
                  <TableHead className="text-right">Check</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {configurations.map((configuration) => {
                  const result = results[configuration.id];
                  const checking = result?.state === "checking";
                  return (
                    <TableRow key={configuration.id}>
                      <TableCell>
                        <div className="font-medium">{configuration.pluginName}</div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {configuration.pluginId}
                        </div>
                      </TableCell>
                      <TableCell>{configurationLabel(configuration)}</TableCell>
                      <TableCell>
                        {result ? (
                          <ResultDetails result={result} />
                        ) : (
                          <span className="text-xs text-muted-foreground">Not checked</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={checking || bulkChecking}
                          onClick={() => checkConnection(configuration)}
                          data-testid={`button-check-wc-${configuration.id}`}
                        >
                          {checking && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
                          Check Connection
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </WcLayout>
  );
}