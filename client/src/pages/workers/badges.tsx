import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { renderIcon } from "@/components/ui/icon-picker";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { format } from "@/lib/date-format";
import { parseISO, isValid } from "date-fns";
import type { WorkerBadgeListItem } from "@shared/schema/worker/badges/schema";

function displayDate(value: string | null): string {
  if (!value) return "Unknown";
  const date = parseISO(value);
  return isValid(date) ? format(date, "MMM d, yyyy h:mm a") : "Unknown";
}

function BadgesContent() {
  const { worker } = useWorkerLayout();
  const { user } = useAuth();
  const url = `/api/workers/${encodeURIComponent(worker.id)}/badges`;
  const query = useQuery<WorkerBadgeListItem[]>({
    // Source enrichment varies with the effective viewer, including masquerades.
    queryKey: [url, user?.id],
    queryFn: () => apiRequest("GET", url),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Award className="h-5 w-5" />Badges</CardTitle>
        <CardDescription>Badges awarded through system activity, oldest grant first.</CardDescription>
      </CardHeader>
      <CardContent>
        {query.isLoading ? (
          <div className="space-y-2" data-testid="loading-badges"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        ) : query.isError ? (
          <div role="alert" className="space-y-3">
            <p>{getApiErrorMessage(query.error, "Failed to load badges.")}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>Retry</Button>
          </div>
        ) : !query.data?.length ? (
          <p className="py-6 text-center text-muted-foreground">No badges have been awarded to this worker.</p>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead>Badge</TableHead><TableHead>Granted</TableHead><TableHead>Status</TableHead><TableHead>Source</TableHead></TableRow></TableHeader>
            <TableBody>
              {query.data.map(badge => (
                <TableRow key={badge.id} data-testid={`row-worker-badge-${badge.id}`}>
                  <TableCell>
                    <div className="flex items-start gap-2">
                      {badge.icon ? renderIcon(badge.icon, "h-5 w-5 shrink-0 text-muted-foreground") : <Award className="h-5 w-5 shrink-0 text-muted-foreground" />}
                      <div><p className="font-medium">{badge.name}</p>{badge.description && <p className="text-sm text-muted-foreground">{badge.description}</p>}</div>
                    </div>
                  </TableCell>
                  <TableCell>{displayDate(badge.grantedTimestamp)}</TableCell>
                  <TableCell>
                    <Badge variant={badge.active === true ? "default" : "secondary"}>
                      {badge.active === true ? "Active" : badge.active === false ? (badge.revokedTimestamp ? "Revoked" : "Inactive") : "Unknown"}
                    </Badge>
                    {badge.revokedTimestamp && <p className="mt-1 text-xs text-muted-foreground">Revoked {displayDate(badge.revokedTimestamp)}</p>}
                  </TableCell>
                  <TableCell>
                    {badge.source ? (
                      <a href={badge.source.href} className="text-primary underline underline-offset-4">
                        <span className="block">{badge.source.title}</span>
                        <span className="text-xs">{badge.source.subtitle}</span>
                      </a>
                    ) : <span className="text-muted-foreground">Source unavailable</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerBadgesPage() {
  return <WorkerLayout activeTab="badges"><BadgesContent /></WorkerLayout>;
}
