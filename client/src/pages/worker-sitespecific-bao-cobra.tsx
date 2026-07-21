import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, CalendarClock, FileSignature } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { WizardLauncher } from "@/components/wizards/WizardLauncher";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { BaoCobraCaseWithDetails } from "@shared/schema/sitespecific/bao/schema";

type CobraCoverage = {
  kind: "medical" | "dental";
  benefitId: string;
  benefitName: string | null;
  ratesByTier: Record<string, string | null>;
};

type CobraTierTotals = {
  preFeeTotal: string;
  adminFee: string;
  total: string;
};

type CobraCaseView = {
  case: BaoCobraCaseWithDetails;
  asOfYmd: string;
  coverage: CobraCoverage[];
  totalsByTier?: Record<string, CobraTierTotals | null>;
};

type WorkerCobraResponse = {
  cases: CobraCaseView[];
};

const TIER_LABELS: Record<string, string> = {
  "1": "1 covered life",
  "2": "2 covered lives",
  "3+": "3 or more covered lives",
};

function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${m}/${d}/${y}`;
}

function formatRate(rate: string | null): string {
  if (rate === null || rate === undefined) return "No rate on file";
  const num = Number(rate);
  if (!Number.isFinite(num)) return rate;
  return num.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function DetailRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 border-b last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}

function isElectable(view: CobraCaseView): boolean {
  const c = view.case;
  if (c.electionMadeYmd) return false;
  if (c.lastDayToElectYmd && view.asOfYmd > c.lastDayToElectYmd) return false;
  return true;
}

function CobraCaseCard({ view, workerId }: { view: CobraCaseView; workerId: string }) {
  const c = view.case;
  const electable = isElectable(view);
  return (
    <div className="space-y-6" data-testid={`card-cobra-case-${c.id}`}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle>COBRA Case</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {c.statusName && (
                <Badge variant="secondary" data-testid={`status-cobra-case-${c.id}`}>
                  {c.statusName}
                </Badge>
              )}
              {c.paymentStatus && (
                <Badge variant="outline" data-testid={`status-cobra-payment-${c.id}`}>
                  {c.paymentStatus}
                </Badge>
              )}
            </div>
          </div>
          <CardDescription>
            Continuation coverage details for this COBRA case.
          </CardDescription>
          {electable && (
            <div className="pt-2">
              <WizardLauncher
                type="bao_cobra_enrollment"
                entityId={workerId}
                successTitle="COBRA election started"
                successDescription="Continue through the steps to elect coverage."
                renderTrigger={({ onClick, disabled }) => (
                  <Button
                    onClick={onClick}
                    disabled={disabled}
                    data-testid={`button-elect-cobra-${c.id}`}
                  >
                    <FileSignature className="h-4 w-4 mr-2" />
                    Elect COBRA Coverage
                  </Button>
                )}
              />
            </div>
          )}
        </CardHeader>
        <CardContent className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
          <div>
            <DetailRow
              label="Qualifying event"
              value={c.qualifyingEventName ?? "—"}
              testId={`text-cobra-event-${c.id}`}
            />
            <DetailRow
              label="Subscriber"
              value={c.subscriberName ?? "—"}
              testId={`text-cobra-subscriber-${c.id}`}
            />
            <DetailRow
              label="Relationship"
              value={c.relationship ?? "Self"}
              testId={`text-cobra-relationship-${c.id}`}
            />
            <DetailRow
              label="COBRA effective date"
              value={formatYmd(c.cobraEffectiveYmd)}
              testId={`text-cobra-effective-${c.id}`}
            />
          </div>
          <div>
            <DetailRow
              label="Offer date"
              value={formatYmd(c.offerYmd)}
              testId={`text-cobra-offer-${c.id}`}
            />
            <DetailRow
              label="Last day to elect"
              value={formatYmd(c.lastDayToElectYmd)}
              testId={`text-cobra-elect-deadline-${c.id}`}
            />
            <DetailRow
              label="Election made"
              value={c.electionMadeYmd ? formatYmd(c.electionMadeYmd) : "Not yet elected"}
              testId={`text-cobra-election-made-${c.id}`}
            />
            <DetailRow
              label="First payment due"
              value={formatYmd(c.initialPaymentDeadlineYmd)}
              testId={`text-cobra-payment-deadline-${c.id}`}
            />
            <DetailRow
              label="Maximum coverage period ends"
              value={formatYmd(c.maxPeriodYmd)}
              testId={`text-cobra-max-period-${c.id}`}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 text-primary" />
            <CardTitle>Coverage You Can Continue</CardTitle>
          </div>
          <CardDescription>
            Monthly cost depends on how many people are covered. Rates shown as of{" "}
            {formatYmd(view.asOfYmd)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.coverage.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid={`text-cobra-no-coverage-${c.id}`}>
              No continuable medical or dental coverage is recorded on this case. Please
              contact the office for details.
            </p>
          ) : (
            <Table data-testid={`table-cobra-rates-${c.id}`}>
              <TableHeader>
                <TableRow>
                  <TableHead>Coverage</TableHead>
                  <TableHead>{TIER_LABELS["1"]}</TableHead>
                  <TableHead>{TIER_LABELS["2"]}</TableHead>
                  <TableHead>{TIER_LABELS["3+"]}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.coverage.map((cov) => (
                  <TableRow key={cov.benefitId} data-testid={`row-cobra-coverage-${cov.benefitId}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="capitalize">
                          {cov.kind}
                        </Badge>
                        <span data-testid={`text-cobra-benefit-${cov.benefitId}`}>
                          {cov.benefitName ?? "Unknown benefit"}
                        </span>
                      </div>
                    </TableCell>
                    {["1", "2", "3+"].map((tier) => (
                      <TableCell key={tier} data-testid={`text-cobra-rate-${cov.benefitId}-${tier}`}>
                        {formatRate(cov.ratesByTier[tier] ?? null)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                {view.totalsByTier && (
                  <>
                    <TableRow data-testid={`row-cobra-subtotal-${c.id}`}>
                      <TableCell className="text-muted-foreground">Subtotal</TableCell>
                      {["1", "2", "3+"].map((tier) => (
                        <TableCell key={tier} data-testid={`text-cobra-subtotal-${c.id}-${tier}`}>
                          {formatRate(view.totalsByTier?.[tier]?.preFeeTotal ?? null)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow data-testid={`row-cobra-admin-fee-${c.id}`}>
                      <TableCell className="text-muted-foreground">
                        COBRA administration fee (2%)
                      </TableCell>
                      {["1", "2", "3+"].map((tier) => (
                        <TableCell key={tier} data-testid={`text-cobra-admin-fee-${c.id}-${tier}`}>
                          {formatRate(view.totalsByTier?.[tier]?.adminFee ?? null)}
                        </TableCell>
                      ))}
                    </TableRow>
                    <TableRow className="font-medium" data-testid={`row-cobra-total-${c.id}`}>
                      <TableCell>Total monthly cost</TableCell>
                      {["1", "2", "3+"].map((tier) => (
                        <TableCell key={tier} data-testid={`text-cobra-total-${c.id}-${tier}`}>
                          {formatRate(view.totalsByTier?.[tier]?.total ?? null)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function WorkerCobraContent() {
  const { worker } = useWorkerLayout();

  const { data, isLoading, isError } = useQuery<WorkerCobraResponse>({
    queryKey: ["/api/workers", worker.id, "sitespecific/bao/cobra"],
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground" data-testid="text-cobra-error">
            Could not load COBRA information. Please try again later.
          </p>
        </CardContent>
      </Card>
    );
  }

  const cases = data?.cases ?? [];

  if (cases.length === 0) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-sm text-muted-foreground" data-testid="text-cobra-no-case">
            There is no open COBRA case on this record.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {cases.map((view) => (
        <CobraCaseCard key={view.case.id} view={view} workerId={worker.id} />
      ))}
    </div>
  );
}

export default function WorkerCobraPage() {
  return (
    <WorkerLayout activeTab="sitespecific-bao-cobra">
      <WorkerCobraContent />
    </WorkerLayout>
  );
}
