import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileOutput, ChevronRight } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

interface EdiSummaryConfig {
  configId: string;
  name: string;
  providerName: string | null;
  state: string;
  stepReachedAt: string | null;
}

interface EdiSummaryData {
  totalConfigs: number;
  stateCounts: Array<{ state: string; count: number }>;
  configs: EdiSummaryConfig[];
}

function stateVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  if (state === "complete") return "default";
  if (state === "error") return "destructive";
  if (state === "never run") return "outline";
  return "secondary";
}

export function EdiSummary(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<EdiSummaryData>(
    "edi-summary",
    { action: "data" },
  );

  if (isLoading) return null;
  if (!data) return null;

  // "12 files: 6 generate, 1 error, 5 complete"
  const summaryLine =
    `${data.totalConfigs} file${data.totalConfigs === 1 ? "" : "s"}` +
    (data.stateCounts.length > 0
      ? `: ${data.stateCounts.map((s) => `${s.count} ${s.state}`).join(", ")}`
      : "");

  return (
    <Card data-testid="card-edi-summary">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <FileOutput className="h-4 w-4 text-muted-foreground" />
          EDI
        </CardTitle>
        <Link
          href="/trust/provider-edi"
          className="text-xs text-primary flex items-center hover:underline"
          data-testid="link-edi-page"
        >
          View all
          <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </CardHeader>
      <CardContent className="space-y-3">
        <div
          className="text-sm text-muted-foreground pb-1 border-b"
          data-testid="text-edi-summary-line"
        >
          {summaryLine}
        </div>

        {data.configs.length === 0 ? (
          <div className="text-sm text-muted-foreground" data-testid="text-edi-no-configs">
            No enabled EDI configurations.
          </div>
        ) : (
          <div className="space-y-2">
            {data.configs.map((cfg) => (
              <div
                key={cfg.configId}
                className="flex items-center justify-between gap-2"
                data-testid={`row-edi-summary-${cfg.configId}`}
              >
                <span className="text-sm truncate" title={cfg.name}>
                  {cfg.name}
                  {cfg.providerName && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({cfg.providerName})
                    </span>
                  )}
                </span>
                <Badge
                  variant={stateVariant(cfg.state)}
                  data-testid={`badge-edi-state-${cfg.configId}`}
                >
                  {cfg.state}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
