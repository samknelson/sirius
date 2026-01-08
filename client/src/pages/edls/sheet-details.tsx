import { format } from "date-fns";
import { Building2, Calendar, Users, FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { Link } from "wouter";
import type { EdlsSheetStatus } from "@shared/schema";

const statusColors: Record<EdlsSheetStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  request: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  lock: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  trash: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  reserved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

const statusLabels: Record<EdlsSheetStatus, string> = {
  draft: "Draft",
  request: "Request",
  lock: "Locked",
  trash: "Trash",
  reserved: "Reserved",
};

function EdlsSheetDetailsContent() {
  const { sheet } = useEdlsSheetLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sheet Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Title</h3>
            <p className="text-foreground" data-testid="text-title">{sheet.title}</p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Employer</h3>
            <p className="text-foreground flex items-center gap-2" data-testid="text-employer">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {sheet.employer ? (
                <Link href={`/employers/${sheet.employer.id}`} className="text-primary hover:underline">
                  {sheet.employer.name}
                </Link>
              ) : (
                "Unknown"
              )}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Date</h3>
            <p className="text-foreground flex items-center gap-2" data-testid="text-date">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              {format(new Date(sheet.date), "PPP")}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Worker Count</h3>
            <p className="text-foreground flex items-center gap-2" data-testid="text-worker-count">
              <Users className="h-4 w-4 text-muted-foreground" />
              {sheet.workerCount}
            </p>
          </div>
          <div>
            <h3 className="text-sm font-medium text-muted-foreground mb-1">Status</h3>
            <div className="flex items-center gap-2" data-testid="text-status">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <Badge className={statusColors[(sheet.status as EdlsSheetStatus) || "draft"]}>
                {statusLabels[(sheet.status as EdlsSheetStatus) || "draft"]}
              </Badge>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EdlsSheetDetailsPage() {
  return (
    <EdlsSheetLayout activeTab="details">
      <EdlsSheetDetailsContent />
    </EdlsSheetLayout>
  );
}
