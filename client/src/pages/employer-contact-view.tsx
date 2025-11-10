import { EmployerContactLayout, useEmployerContactLayout } from "@/components/layouts/EmployerContactLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function EmployerContactViewContent() {
  const { employerContact } = useEmployerContactLayout();

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Contact Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Name</div>
            <div className="text-base" data-testid="text-contact-display-name">
              {employerContact.contact.displayName}
            </div>
          </div>

          <Separator />

          {employerContact.contact.email && (
            <>
              <div>
                <div className="text-sm font-medium text-muted-foreground mb-1">Email</div>
                <div className="text-base" data-testid="text-contact-email">
                  {employerContact.contact.email}
                </div>
              </div>
              <Separator />
            </>
          )}

          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Contact Type</div>
            <div className="text-base" data-testid="text-contact-type">
              {employerContact.contactType ? employerContact.contactType.name : "None"}
            </div>
            {employerContact.contactType?.description && (
              <div className="text-sm text-muted-foreground mt-1">
                {employerContact.contactType.description}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function EmployerContactViewPage() {
  return (
    <EmployerContactLayout activeTab="view">
      <EmployerContactViewContent />
    </EmployerContactLayout>
  );
}
