import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardCheck } from "lucide-react";

function EligibleWorkersCheckContent() {
  const { job } = useDispatchJobLayout();

  return (
    <Card data-testid="card-eligible-workers-check">
      <CardHeader>
        <CardTitle data-testid="text-page-title">Eligibility Check</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12" data-testid="placeholder-content">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <ClipboardCheck className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2" data-testid="text-placeholder-title">
            Eligibility Check
          </h3>
          <p className="text-muted-foreground text-center max-w-md" data-testid="text-placeholder-description">
            This feature will allow you to check worker eligibility for job "{job.name}".
            Content coming soon.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DispatchJobEligibleWorkersCheckPage() {
  return (
    <DispatchJobLayout activeTab="eligible-workers-check">
      <EligibleWorkersCheckContent />
    </DispatchJobLayout>
  );
}
