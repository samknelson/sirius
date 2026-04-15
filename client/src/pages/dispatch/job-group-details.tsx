import { DispatchJobGroupLayout, useDispatchJobGroupLayout } from "@/components/layouts/DispatchJobGroupLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function DetailsContent() {
  const { group } = useDispatchJobGroupLayout();

  return (
    <div className="space-y-6">
      <Card data-testid="card-details">
        <CardHeader>
          <CardTitle>Job Group Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-name">{group.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Start Date</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-start-ymd">{group.startYmd}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">End Date</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-end-ymd">{group.endYmd}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {group.data != null && (
        <Card data-testid="card-data">
          <CardHeader>
            <CardTitle>Data</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-muted p-4 rounded-md overflow-auto max-h-96" data-testid="text-detail-data">
              {JSON.stringify(group.data as Record<string, unknown>, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DispatchJobGroupDetailsPage() {
  return (
    <DispatchJobGroupLayout activeTab="details">
      <DetailsContent />
    </DispatchJobGroupLayout>
  );
}
