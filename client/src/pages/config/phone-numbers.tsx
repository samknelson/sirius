import { useEffect } from "react";
import { useLocation } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";

export default function PhoneNumbersConfigPage() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const timer = setTimeout(() => {
      setLocation("/config/twilio");
    }, 3000);
    return () => clearTimeout(timer);
  }, [setLocation]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Phone Validation Configuration
        </h1>
        <p className="text-muted-foreground mt-2">
          Phone validation is now configured through the SMS Providers page
        </p>
      </div>

      <Alert>
        <ArrowRight className="h-4 w-4" />
        <AlertTitle>Configuration Moved</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            Phone number validation is now controlled by the SMS provider selection.
            When Twilio is the active SMS provider, phone validation will use Twilio Lookup.
            Otherwise, local validation is used.
          </p>
          <p className="text-sm text-muted-foreground">
            You will be redirected automatically in a few seconds...
          </p>
          <Link href="/config/twilio">
            <Button variant="outline" data-testid="button-go-to-sms">
              Go to SMS Providers
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </Link>
        </AlertDescription>
      </Alert>
    </div>
  );
}
