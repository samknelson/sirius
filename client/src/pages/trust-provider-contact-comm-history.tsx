import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommList } from "@/components/worker/CommList";
import { CommWithDetails } from "@/lib/comm-types";

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
