import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ChevronRight, RefreshCw } from "lucide-react";

interface DenormStatusCounts {
  ok: number;
  stale: number;
  error: number;
  total: number;
}

interface DenormConfigSummary {
  id: string;
  pluginId: string;
  name: string | null;
  pluginName: string;
  enabled: boolean;
  counts: DenormStatusCounts;
}

export default function DenormConfigsPage() {
  usePageTitle("Denorm");

  const { data: configs = [], isLoading } = useQuery<DenormConfigSummary[]>({
    queryKey: ["/api/denorm/configs"],
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-xl md:text-2xl font-bold text-foreground flex items-center gap-2"
          data-testid="text-page-title"
        >
          <RefreshCw className="h-6 w-6" />
          Denorm
        </h1>
        <p className="text-muted-foreground mt-2" data-testid="text-page-description">
          Each denorm plugin keeps a slice of data in sync. These numbers show
          how many records are up to date (ok), need recomputing (stale), or
          failed (error).
        </p>
      </div>

      {configs.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p
              className="text-center text-muted-foreground"
              data-testid="text-empty-configs"
            >
              No denorm plugins are configured yet.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="rounded-md border">
          <Table data-testid="table-denorm-configs">
            <TableHeader>
              <TableRow>
                <TableHead>Plugin</TableHead>
                <TableHead>Enabled?</TableHead>
                <TableHead className="text-right">OK</TableHead>
                <TableHead className="text-right">Stale</TableHead>
                <TableHead className="text-right">Error</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((config) => (
                <TableRow key={config.id} data-testid={`row-denorm-${config.id}`}>
                  <TableCell>
                    <Link href={`/admin/denorm/${config.id}`}>
                      <span
                        className="font-medium hover:text-primary cursor-pointer"
                        data-testid={`link-denorm-${config.id}`}
                      >
                        {config.name || config.pluginName}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant={config.enabled ? "default" : "secondary"}>
                      {config.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`text-ok-${config.id}`}
                  >
                    {config.counts.ok}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`text-stale-${config.id}`}
                  >
                    {config.counts.stale}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-testid={`text-error-${config.id}`}
                  >
                    {config.counts.error}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums font-medium"
                    data-testid={`text-total-${config.id}`}
                  >
                    {config.counts.total}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/denorm/${config.id}`}>
                      <Button
                        variant="ghost"
                        size="icon"
                        data-testid={`button-view-${config.id}`}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
