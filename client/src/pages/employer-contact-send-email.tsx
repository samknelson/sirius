import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { CommEmail } from "@/components/comm/CommEmail";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Mail } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function EmployerContactSendEmailContent() {
  const { employerContact } = useEmployerContactLayout();

  if (!employerContact.contact) {
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
      contactId={employerContact.contactId} 
      email={employerContact.contact.email}
      contactName={employerContact.contact.displayName}
    />
  );
}

export default function EmployerContactSendEmail() {
  return (
    <EmployerContactLayout activeTab="send-email">
      <EmployerContactSendEmailContent />
    </EmployerContactLayout>
  );
}
