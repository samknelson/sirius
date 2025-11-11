import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface UploadStepProps {
  wizardId: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function UploadStep({ wizardId, data, onDataChange }: UploadStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Data File</CardTitle>
        <CardDescription>
          Upload the source data file to begin processing
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center p-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground">Upload functionality coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}
