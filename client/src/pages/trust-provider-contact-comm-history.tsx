import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
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

function TrustProviderContactCommHistoryContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  const { data: records = [], isLoading } = useQuery<CommWithDetails[]>({
    queryKey: ["/api/contacts", trustProviderContact.contactId, "comm"],
    enabled: !!trustProviderContact.contactId,
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

export default function TrustProviderContactCommHistory() {
  return (
    <TrustProviderContactLayout activeTab="comm-history">
      <TrustProviderContactCommHistoryContent />
    </TrustProviderContactLayout>
  );
}
