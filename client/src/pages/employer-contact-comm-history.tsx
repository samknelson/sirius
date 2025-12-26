import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommList } from "@/components/worker/CommList";
import { CommWithDetails } from "@/lib/comm-types";

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
