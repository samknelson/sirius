import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { DispatchJobsList } from "@/components/dispatch/DispatchJobsList";

function EmployerDispatchContent() {
  const { employer } = useEmployerLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle data-testid="title-dispatch">Dispatch Jobs</CardTitle>
        <CardDescription>
          Dispatch jobs for {employer.name}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DispatchJobsList
          employerId={employer.id}
          showEmployerColumn={false}
          showNewButton={true}
          newButtonHref={`/dispatch/job/new?employerId=${employer.id}`}
        />
      </CardContent>
    </Card>
  );
}

export default function EmployerDispatchPage() {
  return (
    <EmployerLayout activeTab="dispatch">
      <EmployerDispatchContent />
    </EmployerLayout>
  );
}
