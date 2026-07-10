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

  const anyEnded = rows.some((r) => !r.activeInCurrentMonth);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current Benefits</CardTitle>
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
