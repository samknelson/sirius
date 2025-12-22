import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommList } from "@/components/worker/CommList";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface CommSmsDetails {
  id: string;
  commId: string;
  to: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
}

interface CommWithSms {
  id: string;
  medium: string;
  contactId: string;
  status: string;
  sent: string | null;
  received: string | null;
  data: Record<string, unknown> | null;
  smsDetails?: CommSmsDetails | null;
}

function UserCommHistoryContent() {
  const { contact } = useUserLayout();

  const { data: records = [], isLoading } = useQuery<CommWithSms[]>({
    queryKey: ["/api/contacts", contact?.id, "comm"],
    enabled: !!contact?.id,
  });

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Communication History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Contact Record</AlertTitle>
            <AlertDescription>
              No contact record found for this user. Communication history requires a contact record.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <CommList 
          records={records} 
          isLoading={isLoading}
          title="Communication History"
          emptyMessage="No communication history found for this user."
        />
      </CardContent>
    </Card>
  );
}

export default function UserCommHistory() {
  return (
    <UserLayout activeTab="comm-history">
      <UserCommHistoryContent />
    </UserLayout>
  );
}
