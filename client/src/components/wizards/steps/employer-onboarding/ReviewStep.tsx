import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLocation } from "wouter";
import { ClipboardCheck, Building2, Users, UserPlus, Wallet, Upload, ExternalLink, AlertTriangle, Check } from "lucide-react";

interface ReviewStepProps {
  wizardId: string;
  wizardType: string;
  data?: any;
  onDataChange?: (data: any) => void;
}

export function ReviewStep({ data }: ReviewStepProps) {
  const [, setLocation] = useLocation();
  const results = data?.processingResults;
  const childWizardId = data?.childWizardId;

  const { data: childWizard } = useQuery<any>({
    queryKey: [`/api/wizards/${childWizardId}`],
    enabled: !!childWizardId,
  });

  const { data: ledgerAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/ledger/accounts"],
  });

  const { data: trustBenefits = [] } = useQuery<any[]>({
    queryKey: ["/api/trust-benefits"],
  });

  if (!results) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Review</CardTitle>
          <CardDescription>No processing results available yet. Please complete the previous steps first.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasErrors = results.errors?.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <ClipboardCheck className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Onboarding Review</CardTitle>
            <CardDescription>Summary of everything created during employer onboarding</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasErrors && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Some Issues Occurred</AlertTitle>
            <AlertDescription>
              <ul className="list-disc ml-4 mt-2 space-y-1">
                {results.errors.map((err: any, i: number) => (
                  <li key={i} className="text-sm">{err.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <div className="border rounded-lg divide-y">
          <div className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Building2 size={18} className="text-primary" />
              <h3 className="font-medium">Employer</h3>
              <Badge variant="default" className="ml-auto">
                <Check size={12} className="mr-1" /> Created
              </Badge>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Name:</span>
                <span className="ml-2 font-medium">{results.employer?.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Sirius ID:</span>
                <span className="ml-2 font-medium">{results.employer?.siriusId}</span>
              </div>
            </div>
            {results.employer?.id && (
              <Button
                variant="link"
                size="sm"
                className="px-0 mt-2"
                onClick={() => setLocation(`/employers/${results.employer.id}`)}
              >
                <ExternalLink size={14} className="mr-1" />
                View Employer
              </Button>
            )}
          </div>

          {data?.benefitIds?.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet size={18} className="text-primary" />
                <h3 className="font-medium">Benefit Funds</h3>
              </div>
              <div className="flex flex-wrap gap-2">
                {data.benefitIds.map((id: string) => {
                  const benefit = trustBenefits.find((b: any) => b.id === id);
                  return (
                    <Badge key={id} variant="secondary">
                      {benefit?.name || id}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {results.contacts?.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users size={18} className="text-primary" />
                <h3 className="font-medium">Contacts</h3>
                <Badge variant="outline" className="ml-auto">
                  {results.contacts.length} created
                </Badge>
              </div>
              <div className="space-y-2">
                {results.contacts.map((contact: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm p-2 bg-muted/50 rounded">
                    <div>
                      <span className="font-medium">{contact.name || 'Unnamed'}</span>
                      <span className="text-muted-foreground ml-2">{contact.email}</span>
                    </div>
                    {contact.promoted && (
                      <Badge variant="default" className="text-xs">
                        <UserPlus size={10} className="mr-1" />
                        User Created
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.users?.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <UserPlus size={18} className="text-primary" />
                <h3 className="font-medium">User Accounts</h3>
                <Badge variant="outline" className="ml-auto">
                  {results.users.length} created
                </Badge>
              </div>
              <div className="space-y-2">
                {results.users.map((user: any, i: number) => (
                  <div key={i} className="text-sm p-2 bg-muted/50 rounded">
                    <span className="font-medium">{user.firstName} {user.lastName}</span>
                    <span className="text-muted-foreground ml-2">{user.email}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.ledgerLinks?.length > 0 && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wallet size={18} className="text-primary" />
                <h3 className="font-medium">Ledger Accounts</h3>
                <Badge variant="outline" className="ml-auto">
                  {results.ledgerLinks.length} linked
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {results.ledgerLinks.map((link: any, i: number) => {
                  const account = ledgerAccounts.find((a: any) => a.id === link.accountId);
                  return (
                    <Badge key={i} variant="secondary">
                      {account?.name || link.accountId}
                    </Badge>
                  );
                })}
              </div>
            </div>
          )}

          {childWizardId && (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Upload size={18} className="text-primary" />
                <h3 className="font-medium">Worker Import</h3>
                <Badge
                  variant={childWizard?.status === 'completed' ? 'default' : 'secondary'}
                  className="ml-auto"
                >
                  {childWizard?.status || 'Loading...'}
                </Badge>
              </div>
              <Button
                variant="link"
                size="sm"
                className="px-0"
                onClick={() => setLocation(`/wizards/${childWizardId}`)}
              >
                <ExternalLink size={14} className="mr-1" />
                View Worker Import Wizard
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
