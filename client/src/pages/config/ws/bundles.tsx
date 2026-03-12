import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, Package, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { WsBundle } from "@shared/schema";

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
    active: "default",
    inactive: "secondary",
    deprecated: "destructive",
  };
  return (
    <Badge variant={variants[status] || "outline"} data-testid={`badge-status-${status}`}>
      {status}
    </Badge>
  );
}

export default function WsBundlesPage() {
  usePageTitle("Web Service Bundles");

  const { data: bundles = [], isLoading, error } = useQuery<WsBundle[]>({
    queryKey: ["/api/admin/ws-bundles"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-bundles" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" data-testid="alert-error">
        <AlertDescription>Failed to load bundles. Please try again.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold" data-testid="heading-ws-bundles">
          Web Service Bundles
        </h1>
        <p className="text-muted-foreground mt-2">
          Service bundles define groups of API endpoints available to external clients
        </p>
      </div>

      <Alert data-testid="alert-info">
        <Info className="h-4 w-4" />
        <AlertDescription>
          Bundles are registered in code and cannot be modified here. Use the Clients page to grant access to specific bundles.
        </AlertDescription>
      </Alert>

      <Card data-testid="card-bundles">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Registered Bundles
          </CardTitle>
          <CardDescription>
            {bundles.length} bundle{bundles.length !== 1 ? "s" : ""} registered
          </CardDescription>
        </CardHeader>
        <CardContent>
          {bundles.length === 0 ? (
            <p className="text-muted-foreground text-center py-8" data-testid="text-no-bundles">
              No bundles registered. Run the seed script to create the EDLS bundle.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Bundle</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {bundles.map((bundle) => (
                  <TableRow key={bundle.id} data-testid={`row-bundle-${bundle.id}`}>
                    <TableCell>
                      <div>
                        <div className="font-medium" data-testid={`text-bundle-name-${bundle.id}`}>
                          {bundle.name}
                        </div>
                        {bundle.description && (
                          <div className="text-sm text-muted-foreground">
                            {bundle.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-sm bg-muted px-2 py-1 rounded" data-testid={`text-bundle-code-${bundle.id}`}>
                        {bundle.code}
                      </code>
                    </TableCell>
                    <TableCell data-testid={`text-bundle-version-${bundle.id}`}>
                      {bundle.version}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={bundle.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
