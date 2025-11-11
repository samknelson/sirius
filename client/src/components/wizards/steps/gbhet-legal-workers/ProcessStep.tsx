import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ProcessStepProps {
  wizardId: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function ProcessStep({ wizardId, data, onDataChange }: ProcessStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Process Data</CardTitle>
        <CardDescription>
          Process and transform the data
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center p-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground">Processing functionality coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}
