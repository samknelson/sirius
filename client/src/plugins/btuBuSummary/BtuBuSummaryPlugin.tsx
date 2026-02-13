import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users } from "lucide-react";
import { DashboardPluginProps } from "../types";

interface BuSummaryUnit {
  id: string;
  name: string;
  workerCount: number;
  signedCount: number;
  percentage: number;
}

interface BuSummaryData {
  units: BuSummaryUnit[];
  unassigned: {
    workerCount: number;
    signedCount: number;
    percentage: number;
  } | null;
  totals: {
    workerCount: number;
    signedCount: number;
    percentage: number;
  };
}

function PercentageBar({ percentage }: { percentage: number }) {
  return (
    <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${Math.min(percentage, 100)}%` }}
      />
    </div>
  );
}

export function BtuBuSummaryPlugin({ userPermissions, enabledComponents }: DashboardPluginProps) {
  const hasPermission = userPermissions.includes("admin");
  const hasComponent = enabledComponents?.includes("sitespecific.btu") ?? false;

  const { data, isLoading } = useQuery<BuSummaryData>({
    queryKey: ["/api/dashboard-plugins/btu-bu-summary/data"],
    enabled: hasPermission && hasComponent,
  });

  if (!hasPermission || !hasComponent) return null;
  if (isLoading) return null;
  if (!data || data.units.length === 0) return null;

  const { units, unassigned, totals } = data;

  return (
    <Card data-testid="card-btu-bu-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          Bargaining Unit Summary
        </CardTitle>
        <Badge variant="secondary" data-testid="badge-bu-total-percentage">
          {totals.percentage}% signed
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground pb-1 border-b">
          <span data-testid="text-bu-total-workers">{totals.workerCount.toLocaleString()} total workers</span>
          <span data-testid="text-bu-total-signed">{totals.signedCount.toLocaleString()} signed card checks</span>
        </div>

        <div className="space-y-3">
          {units.map((unit) => (
            <div key={unit.id} className="space-y-1" data-testid={`row-bu-${unit.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm truncate" title={unit.name} data-testid={`text-bu-name-${unit.id}`}>{unit.name}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground tabular-nums" data-testid={`text-bu-ratio-${unit.id}`}>
                    {unit.signedCount}/{unit.workerCount}
                  </span>
                  <span className="text-xs font-medium tabular-nums w-12 text-right" data-testid={`text-bu-percentage-${unit.id}`}>
                    {unit.percentage}%
                  </span>
                </div>
              </div>
              <PercentageBar percentage={unit.percentage} />
            </div>
          ))}

          {unassigned && (
            <div className="space-y-1 pt-1 border-t" data-testid="row-bu-unassigned">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm truncate text-muted-foreground italic" data-testid="text-bu-name-unassigned">No Bargaining Unit</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-muted-foreground tabular-nums" data-testid="text-bu-ratio-unassigned">
                    {unassigned.signedCount}/{unassigned.workerCount}
                  </span>
                  <span className="text-xs font-medium tabular-nums w-12 text-right" data-testid="text-bu-percentage-unassigned">
                    {unassigned.percentage}%
                  </span>
                </div>
              </div>
              <PercentageBar percentage={unassigned.percentage} />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
