import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  TrustElectionLayout,
  useTrustElectionLayout,
} from "@/components/layouts/TrustElectionLayout";
import { ElectionForm } from "@/components/trust/ElectionForm";

function ElectionEditContent() {
  const { election } = useTrustElectionLayout();
  const [, setLocation] = useLocation();

  const detailsHref = `/trust/election/${election.id}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit Trust Election</CardTitle>
        <CardDescription>
          Update this election. The worker cannot be changed.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ElectionForm
          mode="edit"
          workerId={election.workerId}
          election={election}
          onSaved={() => setLocation(detailsHref)}
          onCancel={() => setLocation(detailsHref)}
        />
      </CardContent>
    </Card>
  );
}

export default function ElectionEditPage() {
  return (
    <TrustElectionLayout activeTab="edit">
      <ElectionEditContent />
    </TrustElectionLayout>
  );
}
