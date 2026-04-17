import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MessageSquare, Phone, CheckCircle2, XCircle } from "lucide-react";
import { useState } from "react";

interface PublicOptinData {
  phoneNumber: string;
  optin: boolean;
}

export default function SmsOptinPage() {
  const { token } = useParams<{ token: string }>();
  const [localOptin, setLocalOptin] = useState<boolean | null>(null);

  const { data, isLoading, error, refetch } = useQuery<PublicOptinData>({
    queryKey: ["/api/public/sms-optin", token],
    enabled: !!token,
  });

  const updateOptinMutation = useMutation({
    mutationFn: async (optin: boolean) => {
      return await apiRequest("POST", `/api/public/sms-optin/${token}`, { optin });
    },
    onSuccess: () => {
      refetch();
    },
  });

  const handleOptinChange = (checked: boolean) => {
    setLocalOptin(checked);
    updateOptinMutation.mutate(checked);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mb-4"></div>
            <p className="text-muted-foreground">Loading...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <XCircle className="h-6 w-6 text-destructive" />
            </div>
            <CardTitle>Link Not Found</CardTitle>
            <CardDescription>
              This opt-in link is invalid or has expired. Please contact support if you believe this is an error.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const currentOptin = localOptin !== null ? localOptin : data.optin;

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <MessageSquare className="h-6 w-6 text-primary" />
          </div>
          <CardTitle>SMS Communication Preferences</CardTitle>
          <CardDescription>
            Manage your SMS notification preferences for this phone number
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-md">
            <Phone className="h-5 w-5 text-muted-foreground" />
            <span className="font-mono text-sm">{data.phoneNumber}</span>
          </div>

          <div className="flex items-center justify-between p-4 border rounded-md">
            <div className="space-y-0.5">
              <Label htmlFor="sms-optin" className="text-base font-medium">
                Receive SMS Messages
              </Label>
              <p className="text-sm text-muted-foreground">
                {currentOptin ? "You will receive SMS notifications" : "You will not receive SMS notifications"}
              </p>
            </div>
            <Switch
              id="sms-optin"
              checked={currentOptin}
              onCheckedChange={handleOptinChange}
              disabled={updateOptinMutation.isPending}
              data-testid="switch-public-sms-optin"
            />
          </div>

          {updateOptinMutation.isSuccess && (
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-400 rounded-md">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-sm">Your preferences have been saved.</span>
            </div>
          )}

          {updateOptinMutation.isError && (
            <div className="flex items-center gap-2 p-3 bg-destructive/10 text-destructive rounded-md">
              <XCircle className="h-4 w-4" />
              <span className="text-sm">Failed to save preferences. Please try again.</span>
            </div>
          )}

          <div className="text-center text-xs text-muted-foreground pt-4 border-t">
            <p>
              By opting in, you agree to receive SMS messages from us. 
              Standard message and data rates may apply.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
