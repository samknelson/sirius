import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { EntityEmailManagement } from "@/components/shared";

function EmployerContactEmailContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <Card>
      <CardContent>
        <EntityEmailManagement 
          config={{
            entityId: employerContact.id,
            currentEmail: employerContact.contact.email,
            apiEndpoint: `/api/employer-contacts/${employerContact.id}`,
            apiMethod: "PATCH",
            apiPayloadKey: "email",
            invalidateQueryKeys: [
              "/api/contacts",
              "/api/employer-contacts",
              ["/api/employer-contacts", employerContact.id],
              "/api/employers",
            ],
          }}
        />
      </CardContent>
    </Card>
  );
}

export default function EmployerContactEmail() {
  return (
    <EmployerContactLayout activeTab="email">
      <EmployerContactEmailContent />
    </EmployerContactLayout>
  );
}
