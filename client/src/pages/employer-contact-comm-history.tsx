import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommList } from "@/components/worker/CommList";

interface CommSmsDetails {
  id: string;
  commId: string;
  to: string | null;
  body: string | null;
  data: Record<string, unknown> | null;
}

interface CommEmailDetails {
  id: string;
  commId: string;
  to: string | null;
  toName: string | null;
  from: string | null;
  fromName: string | null;
  replyTo: string | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  data: Record<string, unknown> | null;
}

interface CommWithDetails {
  id: string;
  medium: string;
  contactId: string;
  status: string;
  sent: string | null;
  received: string | null;
  data: Record<string, unknown> | null;
  smsDetails?: CommSmsDetails | null;
  emailDetails?: CommEmailDetails | null;
}

function EmployerContactCommHistoryContent() {
  const { employerContact } = useEmployerContactLayout();

  const { data: records = [], isLoading } = useQuery<CommWithDetails[]>({
    queryKey: ["/api/contacts", employerContact.contactId, "comm"],
    enabled: !!employerContact.contactId,
  });

  return (
    <Card>
      <CardContent className="pt-6">
        <CommList 
          records={records} 
          isLoading={isLoading}
          title="Communication History"
          emptyMessage="No communication history found for this contact."
        />
      </CardContent>
    </Card>
  );
}

export default function EmployerContactCommHistory() {
  return (
    <EmployerContactLayout activeTab="comm-history">
      <EmployerContactCommHistoryContent />
    </EmployerContactLayout>
  );
}
