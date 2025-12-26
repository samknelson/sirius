import { Card, CardContent } from "@/components/ui/card";
import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { EntityEmailManagement } from "@/components/shared";

function TrustProviderContactEmailContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  return (
    <Card>
      <CardContent>
        <EntityEmailManagement 
          config={{
            entityId: trustProviderContact.id,
            currentEmail: trustProviderContact.contact.email,
            apiEndpoint: `/api/trust-provider-contacts/${trustProviderContact.id}/contact/email`,
            apiMethod: "PATCH",
            apiPayloadKey: "email",
            invalidateQueryKeys: [
              "/api/contacts",
              "/api/trust-provider-contacts",
              ["/api/trust-provider-contacts", trustProviderContact.id],
              "/api/trust-providers",
            ],
          }}
        />
      </CardContent>
    </Card>
  );
}

export default function TrustProviderContactEmail() {
  return (
    <TrustProviderContactLayout activeTab="email">
      <TrustProviderContactEmailContent />
    </TrustProviderContactLayout>
  );
}
