import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

export default function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <FileText className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">HTA Connect Terms of Service</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-lg font-semibold" data-testid="heading-sms-terms">SMS/Text Messaging Terms</h2>

            <div className="space-y-1">
              <p className="text-sm font-medium">Program Description:</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                By opting into HTA Connect SMS alerts, you agree to receive automated text messages from HTA Connect (a program of the Hospitality Industry Training and Education Fund) containing time-sensitive job notifications, dispatch offers, and shift reminders.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Message Frequency:</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Message frequency varies and depends entirely on your job availability and dispatch volume.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Pricing:</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Message and data rates may apply. Please consult your wireless carrier for pricing details.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Opt-Out Instructions:</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                You may cancel your SMS subscription at any time. To stop receiving messages, reply STOP, QUIT, END, CANCEL, or UNSUBSCRIBE to any text message you receive from us. You will receive a single confirmation message that you have been successfully unsubscribed.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-sm font-medium">Customer Care/Help Instructions:</p>
              <p className="text-sm leading-relaxed text-muted-foreground">
                If you need assistance or are experiencing issues with the messaging program, reply HELP to any of our messages for more information.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
