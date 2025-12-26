import { Card, CardContent } from "@/components/ui/card";
import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { EntityNameManagement } from "@/components/shared";

function EmployerContactNameContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <Card>
      <CardContent>
        <EntityNameManagement 
          config={{
            entityId: employerContact.id,
            displayName: employerContact.contact.displayName,
            contactData: {
              title: employerContact.contact.title,
              given: employerContact.contact.given,
              middle: employerContact.contact.middle,
              family: employerContact.contact.family,
              generational: employerContact.contact.generational,
              credentials: employerContact.contact.credentials,
            },
            apiEndpoint: `/api/employer-contacts/${employerContact.id}`,
            apiMethod: "PATCH",
            apiPayloadKey: "nameComponents",
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

export default function EmployerContactName() {
  return (
    <EmployerContactLayout activeTab="name">
      <EmployerContactNameContent />
    </EmployerContactLayout>
  );
}
