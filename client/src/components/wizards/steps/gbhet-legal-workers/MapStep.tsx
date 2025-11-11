import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface MapStepProps {
  wizardId: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function MapStep({ wizardId, data, onDataChange }: MapStepProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Map Fields</CardTitle>
        <CardDescription>
          Map data fields to the target schema
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-center p-12 border-2 border-dashed border-border rounded-lg">
          <p className="text-muted-foreground">Field mapping functionality coming soon</p>
        </div>
      </CardContent>
    </Card>
  );
}
