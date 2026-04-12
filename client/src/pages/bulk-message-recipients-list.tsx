import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function BulkMessageRecipientsListContent() {
  const { bulkMessage } = useBulkMessageLayout();

  return (
    <Card data-testid="card-bulk-recipients-list">
      <CardHeader>
        <CardTitle>Recipients</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid="text-recipients-list-stub">
          Recipient list for "{bulkMessage.name}" will be displayed here.
        </p>
      </CardContent>
    </Card>
  );
}

export default function BulkMessageRecipientsListPage() {
  return (
    <BulkMessageLayout activeTab="recipients-list">
      <BulkMessageRecipientsListContent />
    </BulkMessageLayout>
  );
}
