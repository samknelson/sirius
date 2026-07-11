import { useMemo } from "react";
import { ClipboardCheck } from "lucide-react";
import { Link, useLocation, useSearch } from "wouter";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import {
  ENROLLMENT_TYPES,
  type EnrollmentType,
  type WorkerTrustElectionView,
} from "@shared/schema";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const ENROLLMENT_TYPE_LABELS: Record<EnrollmentType, string> = {
  first_time: "First-Time",
  life_event: "Life Event",
  open_enrollment: "Open Enrollment",
};

function isEnrollmentType(value: string | null): value is EnrollmentType {
  return value !== null && (ENROLLMENT_TYPES as readonly string[]).includes(value);
}

function formatYmd(value: string | null): string {
  if (!value) return "—";
  return value.length >= 10 ? value.slice(0, 10) : value;
}

export default function EnrollmentQueue() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const typeParam = new URLSearchParams(search).get("type");
  const activeType: EnrollmentType | null = isEnrollmentType(typeParam) ? typeParam : null;

  const { data: elections = [], isLoading } = useQuery<WorkerTrustElectionView[]>({
    queryKey: ["/api/trust-elections", activeType ?? "all"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (activeType) params.append("enrollmentType", activeType);
      const response = await fetch(`/api/trust-elections?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch enrollment queue");
      }
      return response.json();
    },
  });

  const filters = useMemo(
    () => [
      { type: null as EnrollmentType | null, label: "All" },
      ...ENROLLMENT_TYPES.map((t) => ({ type: t, label: ENROLLMENT_TYPE_LABELS[t] })),
    ],
    [],
  );

  const goToFilter = (type: EnrollmentType | null) => {
    navigate(type ? `/trust/enrollment-queue?type=${type}` : "/trust/enrollment-queue");
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader
        title="Enrollment Queue"
        icon={<ClipboardCheck className="text-primary-foreground" size={16} />}
        actions={
          <span className="text-sm text-muted-foreground" data-testid="text-enrollment-count">
            {elections.length} Enrollments
          </span>
        }
      />

      {/* Per-type filter */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            {filters.map((f) => {
              const isActive = f.type === activeType;
              return (
                <Button
                  key={f.type ?? "all"}
                  variant={isActive ? "default" : "outline"}
                  size="sm"
                  onClick={() => goToFilter(f.type)}
                  data-testid={`button-filter-${f.type ?? "all"}`}
                >
                  {f.label}
                </Button>
              );
            })}
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading ? (
          <p className="text-muted-foreground" data-testid="text-loading">
            Loading enrollments…
          </p>
        ) : elections.length === 0 ? (
          <p className="text-muted-foreground" data-testid="text-empty">
            No enrollments found.
          </p>
        ) : (
          <div className="rounded-md border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Worker</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Employer</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {elections.map((e) => (
                  <TableRow key={e.id} data-testid={`row-election-${e.id}`}>
                    <TableCell data-testid={`text-worker-${e.id}`}>
                      {e.workerName ?? "Unknown worker"}
                    </TableCell>
                    <TableCell data-testid={`text-type-${e.id}`}>
                      {e.enrollmentType && isEnrollmentType(e.enrollmentType)
                        ? ENROLLMENT_TYPE_LABELS[e.enrollmentType]
                        : "—"}
                    </TableCell>
                    <TableCell>{e.employerName ?? "—"}</TableCell>
                    <TableCell>{e.policyName ?? "—"}</TableCell>
                    <TableCell>{formatYmd(e.startYmd)}</TableCell>
                    <TableCell>{formatYmd(e.endYmd)}</TableCell>
                    <TableCell className="text-right">
                      <Link href={`/trust/election/${e.id}`}>
                        <Button variant="outline" size="sm" data-testid={`link-review-${e.id}`}>
                          Review
                        </Button>
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </main>
    </div>
  );
}
