import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrustElectionLayout,
  useTrustElectionLayout,
} from "@/components/layouts/TrustElectionLayout";
import { formatYmd } from "@shared/utils";

function ElectionDetailsContent() {
  const { election, workerName, isWorkerLoading } = useTrustElectionLayout();

  const policyName = election.policyName ?? "Unknown policy";
  const employerName = election.employerName ?? "Unknown employer";
  const benefitLabels = (election.benefits ?? []).map((b) => b.name);
  const relationLabels = (election.relationships ?? []).map((r) => r.label);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Trust Election</CardTitle>
        <CardDescription>
          Worker:{" "}
          <Link
            href={`/workers/${election.workerId}`}
            className="text-primary underline-offset-2 hover:underline"
            data-testid="link-worker"
          >
            {workerName || (isWorkerLoading ? "Loading…" : election.workerId)}
          </Link>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Employer</dt>
            <dd data-testid="text-employer">{employerName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Policy</dt>
            <dd data-testid="text-policy">{policyName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Date</dt>
            <dd data-testid="text-date">
              {formatYmd(election.startYmd)} – {election.endYmd ? formatYmd(election.endYmd) : "ongoing"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Benefits</dt>
            <dd data-testid="text-benefits">
              {benefitLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {benefitLabels.map((label, i) => (
                    <Badge key={i} variant="secondary" data-testid={`chip-benefit-${i}`}>
                      {label}
                    </Badge>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-muted-foreground">Covered relationships</dt>
            <dd data-testid="text-relationships">
              {relationLabels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {relationLabels.map((label, i) => (
                    <Badge key={i} variant="secondary" data-testid={`chip-relation-${i}`}>
                      {label}
                    </Badge>
                  ))}
                </div>
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

export default function ElectionDetailPage() {
  return (
    <TrustElectionLayout activeTab="details">
      <ElectionDetailsContent />
    </TrustElectionLayout>
  );
}
