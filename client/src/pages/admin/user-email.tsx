import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { UserLayout, useUserLayout } from "@/components/layouts/UserLayout";
import { Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";

function UserEmailContent() {
  const { user, contact } = useUserLayout();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mail className="h-5 w-5" />
          Email Address
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <span className="text-sm text-muted-foreground">Primary Email</span>
          <div className="flex items-center gap-2">
            <span className="font-medium" data-testid="text-user-email">{user.email || "No email set"}</span>
            {user.email && <Badge variant="secondary">From Account</Badge>}
          </div>
        </div>

        {contact?.email && contact.email !== user.email && (
          <div className="space-y-2">
            <span className="text-sm text-muted-foreground">Contact Email</span>
            <div className="flex items-center gap-2">
              <span className="font-medium" data-testid="text-contact-email">{contact.email}</span>
              <Badge variant="outline">From Contact</Badge>
            </div>
          </div>
        )}

        {!contact && (
          <div className="text-sm text-muted-foreground">
            No contact record found for this user.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function UserEmail() {
  return (
    <UserLayout activeTab="email">
      <UserEmailContent />
    </UserLayout>
  );
}
