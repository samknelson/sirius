import { WorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalendarDays } from "lucide-react";

function DispatchEbaContent() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2" data-testid="text-eba-title">
            <CalendarDays className="h-5 w-5" />
            Availability Dates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground" data-testid="text-eba-placeholder">
            Availability dates will be managed here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function WorkerDispatchEba() {
  return (
    <WorkerLayout activeTab="dispatch-eba">
      <DispatchEbaContent />
    </WorkerLayout>
  );
}
