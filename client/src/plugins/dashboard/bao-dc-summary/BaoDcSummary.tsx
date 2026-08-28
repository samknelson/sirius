import { useState } from "react";
import { Link } from "wouter";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HeartPulse, Inbox } from "lucide-react";
import { DashboardPluginProps } from "../registry";
import { useDashboardContent } from "../useDashboardContent";

type WorkerRef = { workerId: string; siriusId: number | null; name: string };

interface DcSummaryContent {
  /** Linked count only — the complete list lives on its own page. */
  fmlaEligibleCount: number;
  activeGrants: Array<{
    worker: WorkerRef;
    caseId: string;
    workMonthYmd: string;
    grantedHours: number | null;
    current: boolean;
    yearUsage: { used: number; limit: number };
    latestActivity: { eventType: string; at: string } | null;
  }>;
  queue: Array<{
    case: { id: string; openedYmd: string };
    worker: WorkerRef;
    ageDays: number;
    readiness?: { ready: boolean; missing: string[] };
    monthCount: number;
    yearUsage: Record<string, { used: number; limit: number }>;
  }>;
  maxedOut: Array<{
    worker: WorkerRef;
    year: number;
    used: number;
    limit: number;
    latestActivity: { eventType: string; at: string } | null;
  }>;
  netActivity: Array<{
    workMonthYmd: string;
    grants: number;
    removals: number;
    net: number;
    currentlyGranted: number;
    reconciled: boolean;
  }>;
}

interface DcUploadReviewContent {
  findings: Array<{
    kind: string;
    worker: WorkerRef;
    monthYmd: string;
    employerName?: string;
    detail: string;
  }>;
}

const monthLabel = (ymd: string) => ymd.slice(0, 7);

function WorkerLink({ worker }: { worker: WorkerRef }) {
  return (
    <Link
      href={`/workers/${worker.workerId}`}
      className="text-primary hover:underline"
      data-testid={`link-dc-worker-${worker.workerId}`}
    >
      {worker.name}
    </Link>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <h4 className="text-sm font-medium">{title}</h4>
        <Badge variant="secondary">{count}</Badge>
      </div>
      {count === 0 ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : (
        children
      )}
    </div>
  );
}

const FINDING_LABELS: Record<string, string> = {
  retired_disability_row: "Retired Disability status",
  fmla_gap: "Gap after FMLA",
  reconciliation_actionable: "Reconciliation actionable",
};

export function BaoDcSummary(_props: DashboardPluginProps) {
  const { data, isLoading } = useDashboardContent<DcSummaryContent>("bao-dc-summary");
  const [showUploadReview, setShowUploadReview] = useState(false);
  const uploadReview = useDashboardContent<DcUploadReviewContent>("bao-dc-summary", {
    action: "upload-review",
    enabled: showUploadReview,
  });

  if (!data && isLoading) {
    return (
      <Card data-testid="card-dashboard-bao-dc-summary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <HeartPulse className="h-4 w-4" /> Disability Credit
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  const { fmlaEligibleCount, activeGrants, queue, maxedOut, netActivity } = data;
  const recentNet = netActivity.slice(-6);

  return (
    <Card data-testid="card-dashboard-bao-dc-summary">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartPulse className="h-4 w-4" /> Disability Credit
        </CardTitle>
        <CardDescription>
          Live counts derived from case, month, event, and hours records.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {/* Count only — click through for the complete current list. */}
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h4 className="text-sm font-medium">FMLA Eligible</h4>
            <Badge variant="secondary" data-testid="badge-dc-fmla-eligible-count">
              {fmlaEligibleCount}
            </Badge>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/bao/dc/fmla-eligible" data-testid="link-dc-fmla-eligible">
              View the complete list
            </Link>
          </Button>
        </div>

        <Section title="Approval Queue" count={queue.length}>
          <ul className="space-y-0.5" data-testid="list-dc-queue">
            {queue.slice(0, 8).map((row) => (
              <li key={row.case.id} className="flex justify-between gap-2 items-center">
                <WorkerLink worker={row.worker} />
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground text-xs">
                    {row.monthCount} month(s) · {row.ageDays}d in queue
                  </span>
                  {row.readiness && !row.readiness.ready && (
                    <Badge variant="destructive">Not ready</Badge>
                  )}
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/bao/dc/cases/${row.case.id}`}>Review</Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Currently on Disability Credit" count={activeGrants.length}>
          <ul className="space-y-0.5" data-testid="list-dc-active-grants">
            {activeGrants.slice(0, 8).map((row) => (
              <li
                key={`${row.caseId}-${row.workMonthYmd}`}
                className="flex justify-between gap-2"
              >
                <WorkerLink worker={row.worker} />
                <span className="text-muted-foreground text-xs">
                  {monthLabel(row.workMonthYmd)} · {row.grantedHours ?? "?"}h ·{" "}
                  {row.yearUsage.used}/{row.yearUsage.limit} used
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Annual Maximum Reached" count={maxedOut.length}>
          <ul className="space-y-0.5" data-testid="list-dc-maxed-out">
            {maxedOut.slice(0, 8).map((row) => (
              <li
                key={`${row.worker.workerId}-${row.year}`}
                className="flex justify-between gap-2"
              >
                <WorkerLink worker={row.worker} />
                <span className="text-muted-foreground text-xs">
                  {row.year}: {row.used}/{row.limit}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section title="Net grant activity (recent months)" count={recentNet.length}>
          <ul className="space-y-0.5" data-testid="list-dc-net-activity">
            {recentNet.map((row) => (
              <li key={row.workMonthYmd} className="flex justify-between gap-2">
                <span>{monthLabel(row.workMonthYmd)}</span>
                <span className="text-muted-foreground text-xs flex items-center gap-1">
                  +{row.grants} / −{row.removals} = {row.net}
                  {!row.reconciled && (
                    <Badge variant="destructive">mismatch</Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <div>
          {!showUploadReview ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowUploadReview(true)}
              data-testid="button-dc-upload-review"
            >
              Run upload review
            </Button>
          ) : uploadReview.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <Section
              title="Upload review findings"
              count={uploadReview.data?.findings.length ?? 0}
            >
              <ul className="space-y-0.5" data-testid="list-dc-upload-review">
                {(uploadReview.data?.findings ?? []).slice(0, 10).map((f, i) => (
                  <li key={i} className="flex flex-col">
                    <span className="flex justify-between gap-2">
                      <WorkerLink worker={f.worker} />
                      <span className="text-muted-foreground text-xs">
                        {FINDING_LABELS[f.kind] ?? f.kind} · {monthLabel(f.monthYmd)}
                      </span>
                    </span>
                    <span className="text-xs text-muted-foreground">{f.detail}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>

        <div className="pt-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/bao/dc/queue" data-testid="link-dc-open-queue">
              <Inbox className="h-4 w-4 mr-1" /> Open approval queue
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
