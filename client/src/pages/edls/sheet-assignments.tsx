import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { Users } from "lucide-react";

function EdlsSheetAssignmentsContent() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Assignments
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-center py-8" data-testid="text-assignments-placeholder">
          Worker assignments will be displayed here.
        </p>
      </CardContent>
    </Card>
  );
}

export default function EdlsSheetAssignmentsPage() {
  return (
    <EdlsSheetLayout activeTab="assignments">
      <EdlsSheetAssignmentsContent />
    </EdlsSheetLayout>
  );
}
