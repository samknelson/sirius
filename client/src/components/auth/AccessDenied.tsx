import { AlertCircle, Shield } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface DetailedPolicyResult {
  policy: {
    id: string;
    name: string;
    description?: string;
    scope?: string;
    entityType?: string;
  };
  access: {
    granted: boolean;
    reason?: string;
  };
  evaluatedAt: string;
}

interface AccessDeniedProps {
  policyResult: DetailedPolicyResult;
}

export default function AccessDenied({ policyResult }: AccessDeniedProps) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4" data-testid="access-denied-container">
      <Card className="max-w-2xl w-full">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Shield className="h-8 w-8 text-destructive" />
            <div>
              <CardTitle className="text-2xl">Access Denied</CardTitle>
              <CardDescription>
                You don't have the required access to view this page
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Policy Check Failed: {policyResult.policy.name}</AlertTitle>
            <AlertDescription>
              {policyResult.policy.description || 'Access requirements not met'}
            </AlertDescription>
          </Alert>

          {policyResult.access.reason && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Reason
              </h3>
              <p className="text-sm text-muted-foreground">
                {policyResult.access.reason}
              </p>
            </div>
          )}

          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b">
              <span className="text-muted-foreground">Policy ID:</span>
              <span className="font-mono" data-testid="text-policy-id">{policyResult.policy.id}</span>
            </div>
            {policyResult.policy.scope && (
              <div className="flex justify-between py-2 border-b">
                <span className="text-muted-foreground">Scope:</span>
                <span className="font-mono">{policyResult.policy.scope}</span>
              </div>
            )}
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground">Evaluated At:</span>
              <span className="font-mono text-xs">{new Date(policyResult.evaluatedAt).toLocaleString()}</span>
            </div>
          </div>

          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>What can I do?</AlertTitle>
            <AlertDescription className="space-y-2">
              <p>
                You do not have the required permissions to access this page.
              </p>
              <p className="mt-3 text-sm">
                Please contact your administrator if you believe you should have access.
              </p>
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
