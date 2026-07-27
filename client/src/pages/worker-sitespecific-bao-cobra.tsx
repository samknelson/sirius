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

type CobraPayment = {
  state: "paid" | "grace" | "delinquent";
  balance: string;
};

type CobraDependents = {
  isSubscriber: boolean;
  count: number;
  familyTier: "1" | "2" | "3+";
};

type CobraCaseView = {
  case: BaoCobraCaseWithDetails;
  asOfYmd: string;
  coverage: CobraCoverage[];
  totalsByTier?: Record<string, CobraTierTotals | null>;
  dependents?: CobraDependents;
  payment: CobraPayment | null;
};

const PAYMENT_STATE_LABELS: Record<CobraPayment["state"], string> = {
  paid: "Paid",
  grace: "In grace period",
  delinquent: "Delinquent",
};

const PAYMENT_STATE_CLASSES: Record<CobraPayment["state"], string> = {
  paid: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 border-transparent",
  grace:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 border-transparent",
  delinquent: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-transparent",
};

function formatBalance(balance: string): string {
  const num = Number(balance);
  if (!Number.isFinite(num)) return balance;
  if (num <= 0) return "No amount owed";
  return `${num.toLocaleString("en-US", { style: "currency", currency: "USD" })} owed`;
}

type WorkerCobraResponse = {
  cases: CobraCaseView[];
};

function formatYmd(ymd: string | null | undefined): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  if (!y || !m || !d) return ymd;
  return `${m}/${d}/${y}`;
}

/** Currency string for a valid amount, or null when missing/malformed. */
function formatCurrency(amount: string | null | undefined): string | null {
  if (amount === null || amount === undefined) return null;
  const num = Number(amount);
  if (!Number.isFinite(num)) return null;
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

function CobraCostSentences({ view }: { view: CobraCaseView }) {
  const c = view.case;
  const dependents = view.dependents;
  const hasDependents = !!dependents && dependents.isSubscriber && dependents.count > 0;
  const familyTotal = hasDependents
    ? formatCurrency(view.totalsByTier?.[dependents.familyTier]?.total ?? null)
    : null;
  const individualTotal = formatCurrency(view.totalsByTier?.["1"]?.total ?? null);

  return (
    <div className="space-y-2 text-sm">
      {hasDependents &&
        (familyTotal ? (
          <p data-testid={`text-cobra-family-cost-${c.id}`}>
            The cost of continuing full coverage for you and your dependents is{" "}
            <span className="font-medium">{familyTotal}</span>.
          </p>
        ) : (
          <p className="text-muted-foreground" data-testid={`text-cobra-family-cost-${c.id}`}>
            A rate for continuing coverage for you and your dependents is not on file.
            Please contact the office for pricing.
          </p>
        ))}
      {individualTotal ? (
        <p data-testid={`text-cobra-individual-cost-${c.id}`}>
          The cost of individual coverage will be{" "}
          <span className="font-medium">{individualTotal}</span>.
        </p>
      ) : (
        <p className="text-muted-foreground" data-testid={`text-cobra-individual-cost-${c.id}`}>
          A rate for individual coverage is not on file. Please contact the office for
          pricing.
        </p>
      )}
    </div>
  );
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
              {view.payment ? (
                <Badge
                  variant="outline"
                  className={PAYMENT_STATE_CLASSES[view.payment.state]}
                  data-testid={`status-cobra-payment-${c.id}`}
                >
                  {PAYMENT_STATE_LABELS[view.payment.state]}
                </Badge>
              ) : (
                c.paymentStatus && (
                  <Badge variant="outline" data-testid={`status-cobra-payment-${c.id}`}>
                    {c.paymentStatus}
                  </Badge>
                )
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
            {view.payment && (
              <DetailRow
                label="Outstanding balance"
                value={formatBalance(view.payment.balance)}
                testId={`text-cobra-balance-${c.id}`}
              />
            )}
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
            Monthly costs shown as of {formatYmd(view.asOfYmd)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {view.coverage.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid={`text-cobra-no-coverage-${c.id}`}>
              No continuable medical or dental coverage is recorded on this case. Please
              contact the office for details.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {view.coverage.map((cov) => (
                  <div
                    key={cov.benefitId}
                    className="flex items-center gap-2"
                    data-testid={`row-cobra-coverage-${cov.benefitId}`}
                  >
                    <Badge variant="outline" className="capitalize">
                      {cov.kind}
                    </Badge>
                    <span className="text-sm font-medium" data-testid={`text-cobra-benefit-${cov.benefitId}`}>
                      {cov.benefitName ?? "Unknown benefit"}
                    </span>
                  </div>
                ))}
              </div>
              <CobraCostSentences view={view} />
            </div>
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
