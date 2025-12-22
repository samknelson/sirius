import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { CommEmail } from "@/components/comm/CommEmail";
import { Mail, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function UserSendEmailContent() {
  const { contact } = useUserLayout();

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Send Email
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Contact Record</AlertTitle>
            <AlertDescription>
              No contact record found for this user. Sending email requires a contact record.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <CommEmail 
      contactId={contact.id} 
      email={contact.email}
      contactName={contact.displayName}
    />
  );
}

export default function UserSendEmail() {
  return (
    <UserLayout activeTab="send-email">
      <UserSendEmailContent />
    </UserLayout>
  );
}
