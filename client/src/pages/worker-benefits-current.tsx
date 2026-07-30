import { useQuery } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { renderIcon } from "@/components/ui/icon-picker";
import { Heart } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface CurrentBenefitRow {
  benefitId: string;
  benefitName: string | null;
  benefitType: {
    id: string | null;
    name: string | null;
    color: string | null;
    icon: string | null;
    sequence: number | null;
  };
  activeSinceYear: number;
  activeSinceMonth: number;
  electedOn: string | null;
  activeInCurrentMonth: boolean;
  endDate: string | null;
}

interface WmbScanState {
  lastScan: {
    month: number;
    year: number;
    status: string;
    completedAt: string | null;
    triggerSource: string;
  } | null;
  queued: Array<{ month: number; year: number; status: string }>;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function formatMonthYear(month: number, year: number): string {
  const name = MONTH_NAMES[month - 1] ?? String(month);
  return `${name} ${year}`;
}

function formatYmd(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.slice(0, 10).split("-");
  if (!y || !m || !d) return ymd;
  const name = MONTH_NAMES[Number(m) - 1] ?? m;
  return `${name} ${Number(d)}, ${y}`;
}

function BenefitCell({ row }: { row: CurrentBenefitRow }) {
  const dimmed = !row.activeInCurrentMonth;
  const color = row.benefitType.color ?? undefined;
  const iconEl = renderIcon(row.benefitType.icon ?? undefined, "h-4 w-4");

  return (
    <div className={`flex items-center gap-3 ${dimmed ? "opacity-50" : ""}`}>
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center bg-muted/20 shrink-0"
        style={color ? { color } : undefined}
        data-testid={`icon-benefit-${row.benefitId}`}
      >
        {iconEl ?? <Heart size={14} />}
      </div>
      <span
        className="font-medium"
        style={color ? { color } : undefined}
        data-testid={`text-benefit-name-${row.benefitId}`}
      >
        {row.benefitName ?? "Unknown benefit"}
      </span>
    </div>
  );
}

function WorkerBenefitsCurrentContent() {
  const { worker } = useWorkerLayout();

  const { data: rows = [], isLoading } = useQuery<CurrentBenefitRow[]>({
    queryKey: ["/api/workers", worker.id, "benefits", "current"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/benefits/current`);
      if (!response.ok) {
        throw new Error("Failed to fetch current benefits");
      }
      return response.json();
    },
  });

  const { data: scanState } = useQuery<WmbScanState>({
    queryKey: ["/api/workers", worker.id, "wmb-scan-state"],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${worker.id}/wmb-scan-state`);
      if (!response.ok) {
        throw new Error("Failed to fetch scan state");
      }
      return response.json();
    },
    // Refresh while a scan is queued/processing so the line updates when it finishes.
    refetchInterval: (query) =>
      query.state.data && query.state.data.queued.length > 0 ? 10000 : false,
  });

  const anyEnded = rows.some((r) => !r.activeInCurrentMonth);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Benefits</CardTitle>
        {scanState && (scanState.lastScan || scanState.queued.length > 0) && (
          <div
            className="text-xs text-muted-foreground space-y-0.5"
            data-testid="text-scan-state"
          >
            {scanState.lastScan && (
              <p data-testid="text-last-scan">
                Last benefit scan:{" "}
                {formatMonthYear(scanState.lastScan.month, scanState.lastScan.year)}
                {scanState.lastScan.completedAt &&
                  ` on ${formatYmd(scanState.lastScan.completedAt)}`}
                {scanState.lastScan.status === "failed" && (
                  <span className="text-destructive font-medium"> (failed)</span>
                )}
              </p>
            )}
            {scanState.queued.length > 0 && (
              <p className="text-primary" data-testid="text-scan-queued">
                Scan in progress:{" "}
                {scanState.queued
                  .map((q) => formatMonthYear(q.month, q.year))
                  .join(", ")}
              </p>
            )}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-loading">
            Loading current benefits...
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground" data-testid="text-no-current-benefits">
            No recorded benefits for this worker
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Benefit</TableHead>
                <TableHead>Active Since</TableHead>
                <TableHead>Elected On</TableHead>
                {anyEnded && <TableHead>End Date</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.benefitId} data-testid={`row-current-benefit-${row.benefitId}`}>
                  <TableCell>
                    <BenefitCell row={row} />
                  </TableCell>
                  <TableCell
                    className={row.activeInCurrentMonth ? "" : "opacity-50"}
                    data-testid={`text-active-since-${row.benefitId}`}
                  >
                    {formatMonthYear(row.activeSinceMonth, row.activeSinceYear)}
                  </TableCell>
                  <TableCell
                    className={row.activeInCurrentMonth ? "" : "opacity-50"}
                    data-testid={`text-elected-on-${row.benefitId}`}
                  >
                    {formatYmd(row.electedOn)}
                  </TableCell>
                  {anyEnded && (
                    <TableCell
                      className="opacity-50"
                      data-testid={`text-end-date-${row.benefitId}`}
                    >
                      {row.activeInCurrentMonth ? "—" : formatYmd(row.endDate)}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export default function WorkerBenefitsCurrent() {
  return (
    <WorkerLayout activeTab="benefits-current">
      <WorkerBenefitsCurrentContent />
    </WorkerLayout>
  );
}
