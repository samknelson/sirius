import { BulkMessageLayout, useBulkMessageLayout } from "@/components/layouts/BulkMessageLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Send } from "lucide-react";

function BulkMessageDeliverContent() {
  const { bulkMessage } = useBulkMessageLayout();

  return (
    <Card data-testid="card-bulk-deliver">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Deliver
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" data-testid="text-deliver-placeholder">
          Delivery controls for "{bulkMessage.name}" will be available here.
        </p>
      </CardContent>
    </Card>
  );
}

export default function BulkMessageDeliverPage() {
  return (
    <BulkMessageLayout activeTab="deliver">
      <BulkMessageDeliverContent />
    </BulkMessageLayout>
  );
}
