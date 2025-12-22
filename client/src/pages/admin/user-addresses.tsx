import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import AddressManagement from "@/components/worker/AddressManagement";
import { MapPin, AlertCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function UserAddressesContent() {
  const { user, contact } = useUserLayout();

  if (!contact) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Addresses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>No Contact Record</AlertTitle>
            <AlertDescription>
              No contact record found for this user. Addresses require a contact record.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <AddressManagement workerId={user.id} contactId={contact.id} />
      </CardContent>
    </Card>
  );
}

export default function UserAddresses() {
  return (
    <UserLayout activeTab="addresses">
      <UserAddressesContent />
    </UserLayout>
  );
}
