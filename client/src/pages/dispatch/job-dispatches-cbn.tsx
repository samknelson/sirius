import { Phone } from "lucide-react";
import { DispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function JobDispatchesCbnContent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Call by Name
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Phone className="text-muted-foreground" size={32} />
          </div>
          <h3 className="text-lg font-medium text-foreground mb-2">Coming Soon</h3>
          <p className="text-muted-foreground text-center">
            The Call by Name feature is under development.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function JobDispatchesCbnPage() {
  return (
    <DispatchJobLayout activeTab="dispatches-cbn">
      <JobDispatchesCbnContent />
    </DispatchJobLayout>
  );
}
