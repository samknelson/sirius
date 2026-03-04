import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Shield className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">HTA Connect Privacy Policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold" data-testid="heading-sms-privacy">SMS Consent and Phone Number Privacy</h2>
            <p className="text-sm leading-relaxed text-muted-foreground">
              HTA Connect (a program of the Hospitality Industry Training and Education Fund) respects your privacy. We collect your mobile phone number solely for the purpose of sending secure, internal dispatch notifications and workforce coordination alerts related to your union representation and apprenticeship.
            </p>
            <p className="text-sm leading-relaxed font-medium">
              No Third-Party Sharing:
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We do not sell, rent, or share your personal information, mobile phone number, or SMS opt-in consent data with any third parties, affiliates, or partners for marketing or promotional purposes under any circumstances.
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              All text messaging originator opt-in data and consent are strictly confidential and isolated to the HTA Connect dispatch system.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
