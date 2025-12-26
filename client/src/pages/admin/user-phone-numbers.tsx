import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { PhoneNumberManagement } from "@/components/worker/PhoneNumberManagement";
import { Phone, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function UserPhoneNumbersContent() {
  const { contact } = useUserLayout();

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Phone Numbers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Contact Record</AlertTitle>
            <AlertDescription>
              No contact record found for this user. Phone numbers require a contact record.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <PhoneNumberManagement contactId={contact.id} />
      </CardContent>
    </Card>
  );
}

export default function UserPhoneNumbers() {
  return (
    <UserLayout activeTab="phone-numbers">
      <UserPhoneNumbersContent />
    </UserLayout>
  );
}
