import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { WcLayout } from "@/components/layouts/WebServicesLayout";

interface WcRequest {
  service: string;
  requestType: string;
  operation: string;
  cached: boolean;
  freshForMs: number;
  failureRememberedForMs: number;
}

function formatWindow(ms: number): string {
  if (ms <= 0) return "—";
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  if (ms < 172_800_000) return `${Math.round(ms / 3_600_000)} hr`;
  return `${Math.round(ms / 86_400_000)} days`;
}

export default function WcInfoPage() {
  usePageTitle("Outgoing Web Services Info");

  const { data, isLoading, isError } = useQuery<WcRequest[]>({
    queryKey: ["/api/admin/wc-requests"],
  });

  const groups = Array.from(
    (data ?? []).reduce((map, request) => {
      map.set(request.service, [
        ...(map.get(request.service) ?? []),
        request,
      ]);
      return map;
    }, new Map<string, WcRequest[]>()),
  );

  return (
    <WcLayout activeTab="wc-info">
      <p className="text-muted-foreground">
        Every third-party call this application knows how to make, as
        registered by the code that owns it. A cached request is answered from
        the stored response while it is still inside its freshness window; an
        uncached one goes out every time. A service that is not registered in
        this environment does not appear here at all.
      </p>

      {isLoading ? (
        <Loader2
          className="mx-auto my-16 h-6 w-6 animate-spin"
          data-testid="loading-requests"
        />
      ) : isError ? (
        <p
          className="py-16 text-center text-sm text-muted-foreground"
          data-testid="text-requests-error"
        >
          The registered services could not be loaded.
        </p>
      ) : groups.length === 0 ? (
        <p
          className="py-16 text-center text-sm text-muted-foreground"
          data-testid="text-empty"
        >
          No outbound services are registered in this environment.
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          {groups.map(([service, requests]) => (
            <Card key={service}>
              <CardHeader>
                <CardTitle className="text-base">
                  {service}
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {requests.length}{" "}
                    {requests.length === 1 ? "request type" : "request types"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
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
                      <TableRow key={request.requestType}>
                        <TableCell className="break-all font-medium">
                          {request.requestType}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {request.operation}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={request.cached ? "secondary" : "outline"}
                          >
                            {request.cached ? "Cached" : "Every time"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {formatWindow(request.freshForMs)}
                        </TableCell>
                        <TableCell>
                          {formatWindow(request.failureRememberedForMs)}
                        </TableCell>
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