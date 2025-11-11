import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ValidateStepProps {
  wizardId: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function ValidateStep({ wizardId, data, onDataChange }: ValidateStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Validate Data</CardTitle>
        <CardDescription>
          Validate data integrity and compliance
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center p-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground">Validation functionality coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}
