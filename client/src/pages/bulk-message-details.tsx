import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const mediumLabels: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  postal: "Postal",
  inapp: "In-App",
};

function BulkMessageDetailsContent() {
  const { bulkMessage } = useBulkMessageLayout();

  return (
    <div className="space-y-6">
      <Card data-testid="card-bulk-details">
        <CardHeader>
          <CardTitle>Bulk Message Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Name</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-name">{bulkMessage.name}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Medium</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-medium">
                <Badge variant="outline">
                  {mediumLabels[bulkMessage.medium] || bulkMessage.medium}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-status">
                <Badge variant={bulkMessage.status === "sent" ? "default" : "secondary"}>
                  {bulkMessage.status}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Send Date</dt>
              <dd className="mt-1 text-sm" data-testid="text-bulk-detail-send-date">
                {bulkMessage.sendDate
                  ? new Date(bulkMessage.sendDate).toLocaleString()
                  : <span className="text-muted-foreground">—</span>}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {bulkMessage.data && Object.keys(bulkMessage.data as Record<string, unknown>).length > 0 && (
        <Card data-testid="card-bulk-data">
          <CardHeader>
            <CardTitle>Additional Data</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm bg-muted/50 p-4 rounded-md overflow-auto" data-testid="text-bulk-data-json">
              {JSON.stringify(bulkMessage.data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function BulkMessageDetailsPage() {
  return (
    <BulkMessageLayout activeTab="details">
      <BulkMessageDetailsContent />
    </BulkMessageLayout>
  );
}
