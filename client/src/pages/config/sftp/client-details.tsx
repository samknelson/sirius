import { SftpClientLayout, useSftpClientLayout } from "@/components/layouts/SftpClientLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function DetailsContent() {
  const { destination } = useSftpClientLayout();

  return (
    <div className="space-y-6">
      <Card data-testid="card-details">
        <CardHeader>
          <CardTitle>Destination Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-name">{destination.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Sirius ID</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-sirius-id">
                {destination.siriusId || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-active">
                {destination.active ? "Active" : "Inactive"}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Description</dt>
              <dd className="mt-1 text-sm" data-testid="text-detail-description">
                {destination.description || <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
            {destination.data && (
              <div className="sm:col-span-2">
                <dt className="text-sm font-medium text-muted-foreground">Data</dt>
                <dd className="mt-1 text-sm" data-testid="text-detail-data">
                  <pre className="bg-muted p-3 rounded-md text-xs overflow-auto max-h-48">
                    {JSON.stringify(destination.data, null, 2)}
                  </pre>
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default function SftpClientDetailsPage() {
  return (
    <SftpClientLayout activeTab="details">
      <DetailsContent />
    </SftpClientLayout>
  );
}
