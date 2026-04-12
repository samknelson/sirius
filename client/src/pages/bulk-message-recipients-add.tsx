import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function BulkMessageRecipientsAddContent() {
  const { bulkMessage } = useBulkMessageLayout();

  return (
    <Card data-testid="card-bulk-recipients-add">
      <CardHeader>
        <CardTitle>Add Recipients</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground" data-testid="text-recipients-add-stub">
          Add recipients to "{bulkMessage.name}" here.
        </p>
      </CardContent>
    </Card>
  );
}

export default function BulkMessageRecipientsAddPage() {
  return (
    <BulkMessageLayout activeTab="recipients-add">
      <BulkMessageRecipientsAddContent />
    </BulkMessageLayout>
  );
}
