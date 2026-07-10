import { useQuery, useMutation } from "@tanstack/react-query";
import { usePageTitle } from "@/contexts/PageTitleContext";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BaoDistanceCacheRow } from "@shared/schema/sitespecific/bao/schema";

const CACHE_KEY = ["/api/sitespecific/bao/distance-cache"] as const;

function formatCoord(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(5) : value;
}

function formatMiles(value: string | null | undefined): string {
  if (value == null) return "—";
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)} mi` : value;
}

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

interface RescanResult {
  scanned: number;
  upgraded: number;
  stillStraightLine: number;
}

export default function BaoDistanceCachePage() {
  usePageTitle("BAO Distance Cache");
  const { toast } = useToast();

  const {
    data: rows = [],
    isLoading,
    error,
  } = useQuery<BaoDistanceCacheRow[]>({
    queryKey: CACHE_KEY,
  });

  const rescanMutation = useMutation({
    mutationFn: async () => {
      return (await apiRequest(
        "POST",
        "/api/sitespecific/bao/distance-cache/rescan",
      )) as RescanResult;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: CACHE_KEY });
      toast({
        title: "Rescan complete",
        description: `${result.scanned} straight-line ${
          result.scanned === 1 ? "row" : "rows"
        } checked — ${result.upgraded} upgraded to driving distance, ${
          result.stillStraightLine
        } still straight-line.`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Rescan failed", description: err.message, variant: "destructive" });
    },
  });

  const straightLineCount = rows.filter((r) => r.method === "straight-line").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold" data-testid="title-bao-distance-cache">
            BAO Distance Cache
          </h1>
          <p className="text-muted-foreground">
            Measured worker-to-site distances cached so eligibility scans don't re-query the
            mapping service for the same coordinates. Driving-distance rows are authoritative;
            straight-line rows are approximations that are re-attempted on every scan and by the
            rescan action below.
          </p>
        </div>
        <Button
          onClick={() => rescanMutation.mutate()}
          disabled={rescanMutation.isPending || straightLineCount === 0}
          data-testid="button-rescan-straight-line"
        >
          {rescanMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Rescan straight-line rows{straightLineCount > 0 ? ` (${straightLineCount})` : ""}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cached distances</CardTitle>
          <CardDescription>
            {rows.length} cached {rows.length === 1 ? "pair" : "pairs"}, oldest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-center py-8 text-destructive" data-testid="text-cache-error">
              {(error as Error).message}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground" data-testid="text-no-cache">
              No distances cached yet. Rows appear as eligibility scans measure worker-to-site
              distances.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origin (lat, lng)</TableHead>
                  <TableHead>Destination (lat, lng)</TableHead>
                  <TableHead>Distance</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Computed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id} data-testid={`row-cache-${r.id}`}>
                    <TableCell data-testid={`text-cache-origin-${r.id}`}>
                      {formatCoord(r.originLat)}, {formatCoord(r.originLng)}
                    </TableCell>
                    <TableCell data-testid={`text-cache-dest-${r.id}`}>
                      {formatCoord(r.destLat)}, {formatCoord(r.destLng)}
                    </TableCell>
                    <TableCell data-testid={`text-cache-distance-${r.id}`}>
                      {formatMiles(r.distanceMiles)}
                    </TableCell>
                    <TableCell data-testid={`status-cache-method-${r.id}`}>
                      {r.method === "driving" ? (
                        <Badge>Driving</Badge>
                      ) : (
                        <Badge variant="secondary">Straight-line</Badge>
                      )}
                    </TableCell>
                    <TableCell data-testid={`text-cache-computed-${r.id}`}>
                      {formatDateTime(r.computedAt)}
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
