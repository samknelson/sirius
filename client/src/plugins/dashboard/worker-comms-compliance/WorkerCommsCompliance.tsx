import { Link } from "wouter";
import { AlertCircle, ArrowDownRight, ArrowUpRight, ClipboardCheck, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";
import { getCommStatusLabel } from "@shared/commStatus";
import { resolveBenefitPeriod, type ResolvedBenefitPeriod, type WorkerCommsCounts, type WorkerCommsDefinition } from "@shared/worker-comms-compliance";
import { cn } from "@/lib/utils";
import { formatYmdMonth } from "@shared/utils/date";

interface DashboardComplianceContent {
  definitions: Array<{
    definition: WorkerCommsDefinition;
    tagName: string;
    counts: WorkerCommsCounts | null;
    benefitPeriod?: ResolvedBenefitPeriod;
    error?: string;
  }>;
  benefitMonth: string;
}

function monthLabel(month: string) {
  return formatYmdMonth(`${month}-01`);
}

function sentRange(definition: WorkerCommsDefinition) {
  if (!definition.sentFrom && !definition.sentThrough) return "Any sent date";
  return `${definition.sentFrom || "Any date"} – ${definition.sentThrough || "Any date"}`;
}

function mediumLabel(definition: WorkerCommsDefinition) {
  if (!definition.medium) return "Any medium";
  return ({ email: "Email", sms: "SMS", postal: "Postal", inapp: "In-app" } as const)[definition.medium];
}

export function WorkerCommsCompliance(_props: DashboardPluginProps) {
  const { data, isLoading, isError, refetch, isFetching } = useDashboardContent<DashboardComplianceContent>("worker-comms-compliance");

  return (
    <Card data-testid="plugin-worker-comms-compliance" className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-3 border-b border-border bg-card pb-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <span className="rounded-md bg-primary/10 p-2 text-primary"><ClipboardCheck className="h-4 w-4" /></span>
            Distribution compliance
          </CardTitle>
          <p className="mt-2 text-xs text-muted-foreground">
            {data?.benefitMonth ? `Reference month · ${monthLabel(data.benefitMonth)}` : "Benefit reference month"}
          </p>
        </div>
        <Button variant="ghost" size="icon" aria-label="Refresh compliance summary" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
        </Button>
      </CardHeader>
      <CardContent className="p-4">
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading distribution compliance">
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
            <div className="h-16 animate-pulse rounded-lg bg-muted" />
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
            <AlertCircle className="h-5 w-5 text-destructive" />
            <p className="mt-2 text-sm font-medium">Couldn’t load compliance totals.</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : !data ? (
          <div className="py-5 text-center text-sm text-muted-foreground">This summary is not available for your account.</div>
        ) : data.definitions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center">
            <ClipboardCheck className="mx-auto h-6 w-6 text-muted-foreground/70" />
            <p className="mt-2 text-sm font-medium">No definitions yet</p>
            <p className="mt-1 text-xs text-muted-foreground">A benefits administrator can set up the first distribution review.</p>
            <Link href="/workers/comms-compliance" className="mt-3 inline-flex items-center text-sm font-semibold text-primary hover:underline">
              Open compliance definitions
              <ArrowUpRight className="ml-1 h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-2">
            {data.definitions.map(({ definition, tagName, counts, error, benefitPeriod }) => {
              let period = benefitPeriod;
              if (!period) {
                try {
                  period = resolveBenefitPeriod(definition.population, data.benefitMonth);
                } catch {
                  period = undefined;
                }
              }
              return (
              <Link
                key={definition.id}
                href={`/workers/comms-compliance?definitionId=${encodeURIComponent(definition.id)}&view=without`}
                className="block rounded-lg border border-border p-3 transition-colors hover:border-primary/40 hover:bg-primary/[0.035]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{definition.name}</div>
                    <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] leading-relaxed text-muted-foreground">
                      <span>Tag: {tagName}</span>
                      <span aria-hidden="true">·</span>
                      <span>Status: {definition.statuses.map(getCommStatusLabel).join(", ")}</span>
                      <span aria-hidden="true">·</span>
                      <span>Medium: {mediumLabel(definition)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Sent: {sentRange(definition)}</span>
                      <span aria-hidden="true">·</span>
                      <span>Benefit history: {period?.label ?? "Period unavailable"}</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                      {definition.population.benefitIds.length
                        ? "Any selected benefit in any included month matches; monthly coverage overlap is used."
                        : "No benefit restriction."} Communication sent dates are separate.
                    </p>
                    {error ? (
                      <div className="mt-1 text-xs text-destructive">{error}</div>
                    ) : counts ? (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{counts.population.toLocaleString()} expected</span>
                        <span>{counts.with.toLocaleString()} matched</span>
                      </div>
                    ) : (
                      <div className="mt-1 text-xs text-muted-foreground">Counts not available</div>
                    )}
                  </div>
                  {counts && !error ? (
                    <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", counts.without > 0 ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-900")}>
                      {counts.without.toLocaleString()} missing
                    </span>
                  ) : <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </div>
                {counts && !error && (
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Open missing recipients</span>
                    {counts.without > 0 ? <ArrowDownRight className="h-3.5 w-3.5 text-amber-800" /> : <span className="font-medium text-emerald-800">Complete</span>}
                  </div>
                )}
              </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
