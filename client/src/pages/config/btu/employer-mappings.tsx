import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

export default function BtuEmployerMappingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
          BTU Employer Mappings
        </h1>
        <p className="text-muted-foreground">
          Configure employer mappings for BTU integrations.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Construction className="h-5 w-5" />
            Coming Soon
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground" data-testid="text-stub-message">
            This feature is under development. BTU employer mappings will allow you to 
            configure how employers are mapped between systems.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
