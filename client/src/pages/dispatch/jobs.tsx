import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DispatchJobsList } from "@/components/dispatch/DispatchJobsList";

export default function DispatchJobsPage() {
  return (
    <div className="container mx-auto py-8">
      <Card>
        <CardHeader>
          <CardTitle data-testid="title-page">Dispatch Jobs</CardTitle>
          <CardDescription>
            Manage and track dispatch jobs
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DispatchJobsList 
            showEmployerColumn={true}
            showNewButton={true}
            newButtonHref="/dispatch/job/new"
          />
        </CardContent>
      </Card>
    </div>
  );
}
