import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { EntityNameManagement } from "@/components/shared";

function TrustProviderContactNameContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return (
    <Card>
      <CardContent>
        <EntityNameManagement 
          config={{
            entityId: trustProviderContact.id,
            displayName: trustProviderContact.contact.displayName,
            contactData: {
              title: trustProviderContact.contact.title,
              given: trustProviderContact.contact.given,
              middle: trustProviderContact.contact.middle,
              family: trustProviderContact.contact.family,
              generational: trustProviderContact.contact.generational,
              credentials: trustProviderContact.contact.credentials,
            },
            apiEndpoint: `/api/trust-provider-contacts/${trustProviderContact.id}/contact/name`,
            apiMethod: "PATCH",
            invalidateQueryKeys: [
              "/api/contacts",
              "/api/trust-provider-contacts",
              ["/api/trust-provider-contacts", trustProviderContact.id],
              "/api/trust-providers",
            ],
            showNameComponentsPreview: true,
          }}
        />
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactName() {
  return (
    <TrustProviderContactLayout activeTab="name">
      <TrustProviderContactNameContent />
    </TrustProviderContactLayout>
  );
}
