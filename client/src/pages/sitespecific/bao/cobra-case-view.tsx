import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BaoCobraCaseLayout,
  useBaoCobraCaseLayout,
} from "@/components/layouts/BaoCobraCaseLayout";
import { cobraSourceLabel } from "@/components/sitespecific/bao/CobraCaseForm";

function formatYmd(value: string | null | undefined): string {
  if (!value) return "—";
  const ymd = value.slice(0, 10);
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd;
  return `${parseInt(m[2])}/${parseInt(m[3])}/${m[1]}`;
}

function Field({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="font-medium" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

function CaseDetails() {
  const { cobraCase: c } = useBaoCobraCaseLayout();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Case</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-muted-foreground">Status</p>
            <Badge
              variant={c.statusClosed ? "outline" : "secondary"}
              data-testid="badge-case-status"
            >
              {c.statusName ?? "—"}
            </Badge>
          </div>
          <Field
            label="Qualifying Event"
            value={c.qualifyingEventName ?? "—"}
            testId="text-case-event"
          />
          <Field label="Source" value={cobraSourceLabel(c.source)} testId="text-case-source" />
          <Field
            label="Payment Status"
            value={c.paymentStatus ?? "—"}
            testId="text-case-payment-status"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>People</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <Field
            label="Covered Person"
            value={c.coveredPersonName ?? "—"}
            testId="text-case-covered-person"
          />
          <Field
            label="Subscriber"
            value={c.subscriberName ?? "—"}
            testId="text-case-subscriber"
          />
          <Field
            label="Relationship"
            value={c.relationship ?? "—"}
            testId="text-case-relationship"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dates & Deadlines</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field
            label="Benefit End / COBRA Effective"
            value={formatYmd(c.cobraEffectiveYmd)}
            testId="text-case-effective"
          />
          <Field label="Offer Date" value={formatYmd(c.offerYmd)} testId="text-case-offer" />
          <Field
            label="Last Day to Elect"
            value={formatYmd(c.lastDayToElectYmd)}
            testId="text-case-elect-by"
          />
          <Field
            label="Election Made"
            value={formatYmd(c.electionMadeYmd)}
            testId="text-case-election-made"
          />
          <Field
            label="Initial Payment Deadline"
            value={formatYmd(c.initialPaymentDeadlineYmd)}
            testId="text-case-payment-deadline"
          />
          <Field
            label="Max COBRA Period"
            value={formatYmd(c.maxPeriodYmd)}
            testId="text-case-max-period"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Benefits Lost</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <Field
            label="Medical Benefit Lost"
            value={c.medicalBenefitLostName ?? "—"}
            testId="text-case-medical-lost"
          />
          <Field
            label="Dental Benefit Lost"
            value={c.dentalBenefitLostName ?? "—"}
            testId="text-case-dental-lost"
          />
        </CardContent>
      </Card>
    </div>
  );
}

export default function BaoCobraCaseView() {
  return (
    <BaoCobraCaseLayout activeTab="details">
      <CaseDetails />
    </BaoCobraCaseLayout>
  );
}
