import { WorkerHoursLayout, useWorkerHoursLayout } from "@/components/layouts/WorkerHoursLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";

function getMonthName(month: number): string {
  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return monthNames[month - 1];
}

function WorkerHoursViewContent() {
  const { hoursEntry } = useWorkerHoursLayout();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Hours Entry Details</CardTitle>
          <CardDescription>View hours entry information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="text-sm font-medium text-muted-foreground">Entry ID</label>
              <p className="mt-1 font-mono text-sm" data-testid="text-hours-id">{hoursEntry.id}</p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Date</label>
              <p className="mt-1" data-testid="text-hours-date">
                {getMonthName(hoursEntry.month)} {hoursEntry.day}, {hoursEntry.year}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Employer</label>
              <p className="mt-1" data-testid="text-hours-employer">
                {hoursEntry.employer?.name || "Unknown"}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Employment Status</label>
              <p className="mt-1" data-testid="text-hours-employment-status">
                {hoursEntry.employmentStatus?.name || "Unknown"}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Hours Worked</label>
              <p className="mt-1 font-mono text-lg font-semibold" data-testid="text-hours-value">
                {hoursEntry.hours !== null ? hoursEntry.hours.toFixed(2) : "-"}
              </p>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Home</label>
              <div className="mt-1">
                {hoursEntry.home ? (
                  <Badge variant="default" data-testid="badge-hours-home">Home</Badge>
                ) : (
                  <span className="text-muted-foreground" data-testid="text-hours-not-home">Not home</span>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium text-muted-foreground">Job Title</label>
              <p className="mt-1" data-testid="text-hours-job-title">
                {hoursEntry.jobTitle || <span className="text-muted-foreground">-</span>}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <LedgerTransactionsView
        queryKey={[`/api/worker-hours/${hoursEntry.id}/transactions`]}
        title="Related Ledger Transactions"
        csvFilename={`hours-entry-${hoursEntry.id}-transactions.csv`}
        showEntityType={true}
        showEntityName={true}
        showEaAccount={true}
        showEaLink={true}
      />
    </div>
  );
}

export default function WorkerHoursView() {
  return (
    <WorkerHoursLayout activeTab="view">
      <WorkerHoursViewContent />
    </WorkerHoursLayout>
  );
}
