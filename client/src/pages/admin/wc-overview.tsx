import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { WcLayout } from "@/components/layouts/WebServicesLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2 } from "lucide-react";

/**
 * Every outbound call we are able to make.
 *
 * This is the registry as it stands in the running process, not a written
 * list: a service whose module is not loaded in this environment is simply
 * absent, which is the honest answer to "what can we call from here". It is
 * also not a usage report — a request type nobody has ever called still
 * appears, because being able to call it is the fact this page states.
 */

interface WcRequest {
  service: string;
  requestType: string;
  operation: string;
  cached: boolean;
  needsWritableDatabase: boolean;
  freshForMs: number;
  failureRememberedForMs: number;
}

/** A window in the largest unit that stays readable. */
function formatWindow(ms: number): string {
  if (ms <= 0) return "—";
  const minutes = ms / 60000;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${Math.round(hours)} hr`;
  return `${Math.round(hours / 24)} days`;
}

function groupByService(requests: WcRequest[]): [string, WcRequest[]][] {
  const byService = new Map<string, WcRequest[]>();
  for (const request of requests) {
    const existing = byService.get(request.service);
    if (existing) existing.push(request);
    else byService.set(request.service, [request]);
  }
  return Array.from(byService);
}

export default function WcOverviewPage() {
  usePageTitle("Outgoing Web Services");

  const { data, isLoading, isError } = useQuery<WcRequest[]>({
    queryKey: ["/api/admin/wc-requests"],
  });

  const services = groupByService(data ?? []);

  return (
    <WcLayout activeTab="wc-overview">
      <p className="text-muted-foreground" data-testid="text-page-description">
        Every third-party call this application knows how to make, as registered
        by the code that owns it. A cached request is answered from the stored
        response while it is still inside its freshness window; an uncached one
        goes out every time. A service that is not registered in this
        environment does not appear here at all.
      </p>

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin" data-testid="loading-requests" />
        </div>
      ) : isError ? (
        <p
          className="py-16 text-center text-sm text-muted-foreground"
          data-testid="text-requests-error"
        >
          The registered services could not be loaded.
        </p>
      ) : services.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground" data-testid="text-empty">
          No outbound services are registered in this environment.
        </p>
      ) : (
        <div className="space-y-4">
          {services.map(([service, requests]) => (
            <Card key={service} data-testid={`card-service-${service}`}>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  {service}
                  <span className="text-xs font-normal text-muted-foreground">
                    {requests.length} {requests.length === 1 ? "request type" : "request types"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table data-testid={`table-service-${service}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Request type</TableHead>
                      <TableHead>What it does</TableHead>
                      <TableHead>Answers kept</TableHead>
                      <TableHead>Fresh for</TableHead>
                      <TableHead>Failure remembered</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.map((request) => (
                      <TableRow
                        key={request.requestType}
                        data-testid={`row-request-${service}-${request.requestType}`}
                      >
                        <TableCell className="font-medium break-all">
                          {request.requestType}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {request.operation}
                        </TableCell>
                        <TableCell>
                          {request.cached ? (
                            <Badge variant="secondary" data-testid="badge-cached">
                              Cached
                            </Badge>
                          ) : (
                            <Badge variant="outline" data-testid="badge-uncached">
                              Every time
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>{formatWindow(request.freshForMs)}</TableCell>
                        <TableCell>{formatWindow(request.failureRememberedForMs)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </WcLayout>
  );
}
