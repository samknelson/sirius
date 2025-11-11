import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ReviewStepProps {
  wizardId: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function ReviewStep({ wizardId, data, onDataChange }: ReviewStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review Results</CardTitle>
        <CardDescription>
          Review the processed results before completion
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center p-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground">Review functionality coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}
