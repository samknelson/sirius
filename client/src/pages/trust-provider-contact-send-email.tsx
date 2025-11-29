import { TrustProviderContactLayout, useTrustProviderContactLayout } from "@/components/layouts/TrustProviderContactLayout";
import { CommEmail } from "@/components/comm/CommEmail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function TrustProviderContactSendEmailContent() {
  const { trustProviderContact } = useTrustProviderContactLayout();

  if (!trustProviderContact.contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Email
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Contact Not Found</AlertTitle>
            <AlertDescription>
              Unable to load contact information.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <CommEmail 
      contactId={trustProviderContact.contactId} 
      email={trustProviderContact.contact.email}
      contactName={trustProviderContact.contact.displayName}
    />
  );
}

export default function TrustProviderContactSendEmail() {
  return (
    <TrustProviderContactLayout activeTab="send-email">
      <TrustProviderContactSendEmailContent />
    </TrustProviderContactLayout>
  );
}
