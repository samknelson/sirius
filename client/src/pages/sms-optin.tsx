import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MessageSquare, Phone, CheckCircle2, XCircle } from "lucide-react";

interface PublicOptinData {
  phoneNumber: string;
  optin: boolean;
}

export default function SmsOptinPage() {
  const { token } = useParams<{ token: string }>();

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

  const handleOptinChange = (checked: boolean | "indeterminate") => {
    if (checked === "indeterminate") return;
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

          <div className="space-y-3 p-4 border rounded-md">
            <div className="flex items-start gap-3">
              <Checkbox
                id="sms-optin"
                checked={data.optin}
                onCheckedChange={handleOptinChange}
                disabled={updateOptinMutation.isPending}
                data-testid="checkbox-public-sms-optin"
              />
              <Label htmlFor="sms-optin" className="text-sm leading-relaxed cursor-pointer">
                By checking this box, you agree to receive automated dispatch alerts from HTA Connect (a program of the Hospitality Industry Training and Education Fund). Message and data rates may apply. Frequency depends on job availability. Text STOP to cancel, HELP for help.
              </Label>
            </div>
            <div className="flex gap-4 pl-7 text-xs">
              <a href="/privacy" className="text-primary underline hover:no-underline" data-testid="link-privacy-policy">Privacy Policy</a>
              <a href="/terms" className="text-primary underline hover:no-underline" data-testid="link-terms-of-service">Terms of Service</a>
            </div>
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
        </CardContent>
      </Card>
    </div>
  );
}
