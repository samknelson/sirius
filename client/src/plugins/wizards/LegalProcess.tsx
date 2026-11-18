import { Link } from "wouter";
import { ArrowUpRight, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent } from "@/components/ui/card";
import { RunProgressView } from "@/components/wizards/framework/RunProgressView";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";
import { LegalConfirmation } from "./LegalConfirmation";

export function LegalProcess(props: WizardStepComponentProps) {
  const isRunning = props.step.progress?.status === "in_progress";

  return (
    <div className="space-y-4">
      {isRunning && (
        <Card className="border-primary/20 bg-primary/[0.035] shadow-none">
          <CardContent className="space-y-3 p-4">
            <Alert className="border-0 bg-transparent p-0">
              <Info className="h-4 w-4" />
              <AlertDescription>
                You can leave this page. Processing will continue in the background. Return to this upload to check progress and results.
              </AlertDescription>
            </Alert>
            <div className="flex flex-col gap-2 text-sm sm:flex-row sm:gap-5">
              <Link
                href="/employers/monthly-uploads"
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                Monthly uploads <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href={`/wizards/${props.wizardId}`}
                className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
              >
                Return to this upload <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardContent>
        </Card>
      )}
      <RunProgressView {...props} />
      {props.step.progress?.status === "failed" && <LegalConfirmation {...props} />}
    </div>
  );
}
