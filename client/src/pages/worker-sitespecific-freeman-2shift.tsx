import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout } from "@/components/layouts/WorkerLayout";

function WorkerSecondShiftContent() {
  return (
    <Card data-testid="card-second-shift-stub">
      <CardHeader>
        <CardTitle>Second Shift</CardTitle>
        <CardDescription>
          This page is a placeholder. Second-shift configuration for this worker will live here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" data-testid="text-second-shift-coming-soon">
          Coming soon.
        </p>
      </CardContent>
    </Card>
  );
}

export default function WorkerSecondShift() {
  return (
    <WorkerLayout activeTab="sitespecific-freeman-2shift">
      <WorkerSecondShiftContent />
    </WorkerLayout>
  );
}
