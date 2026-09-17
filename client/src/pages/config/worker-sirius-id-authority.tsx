import { useEffect, useState } from "react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { getApiErrorMessage } from "@/lib/queryClient";
import { useSetVariable, useVariableValue } from "@/lib/use-variable";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Database, ShieldAlert } from "lucide-react";

const VARIABLE_NAME = "worker_sirius_id_authority";
type Authority = "external" | "s2";

function authorityOf(value: unknown): Authority {
  return value === "s2" ? "s2" : "external";
}

export default function WorkerSiriusIdAuthorityPage() {
  usePageTitle("Worker Sirius ID Authority");
  const { toast } = useToast();
  const { data: storedValue, isLoading } = useVariableValue(VARIABLE_NAME);
  const current = authorityOf(storedValue);
  const [selected, setSelected] = useState<Authority>("external");
  const [confirmation, setConfirmation] = useState("");

  useEffect(() => {
    setSelected(authorityOf(storedValue));
    setConfirmation("");
  }, [storedValue]);

  const save = useSetVariable(VARIABLE_NAME, {
    onSuccess: () => {
      setConfirmation("");
      toast({
        title: "Worker Sirius ID authority saved",
        description: "The database allocation policy has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Unable to save worker Sirius ID authority",
        description: getApiErrorMessage(error, "The allocation policy was not changed."),
        variant: "destructive",
      });
    },
  });

  const requiresConfirmation = current !== "s2" && selected === "s2";
  const canSave = selected !== current &&
    (!requiresConfirmation || confirmation === "ENABLE S2");

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-semibold" data-testid="heading-worker-sirius-id-authority">
          Worker Sirius ID Authority
        </h1>
        <p className="mt-1 text-muted-foreground">
          Choose whether worker Sirius IDs come from the external source or may be allocated by Sirius.
        </p>
      </div>

      <Alert variant="destructive" data-testid="alert-worker-sirius-id-authority">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>S1 migration safety</AlertTitle>
        <AlertDescription>
          Keep External/S1 authority selected until the migration is fully complete. In this mode,
          workers created without an authoritative Sirius ID keep a NULL Sirius ID; no local ID is invented.
          Before selecting Sirius/S2 authority, freeze S1 worker imports and complete the documented
          migration cutover; changing this setting does not freeze an import by itself.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Allocation authority
          </CardTitle>
          <CardDescription>
            This is enforced by the database default as well as application writes. Existing worker
            Sirius IDs are never changed by this setting.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <RadioGroup
            value={selected}
            onValueChange={(value) => setSelected(value as Authority)}
            disabled={save.isPending}
            className="space-y-4"
          >
            <div className="flex items-start gap-3 rounded-md border p-4">
              <RadioGroupItem value="external" id="authority-external" data-testid="radio-worker-sid-authority-external" />
              <div>
                <Label htmlFor="authority-external" className="cursor-pointer font-medium">
                  External / S1 authority (safe default)
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  Source-worker imports must provide their exact S1 Sirius ID. Native workers and relationship
                  shells without one retain NULL.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-md border p-4">
              <RadioGroupItem value="s2" id="authority-s2" data-testid="radio-worker-sid-authority-s2" />
              <div>
                <Label htmlFor="authority-s2" className="cursor-pointer font-medium">
                  Sirius / S2 authority (post-cutover only)
                </Label>
                <p className="mt-1 text-sm text-muted-foreground">
                  The database allocates a new Sirius ID when a worker is created without one. Do not enable
                  while any S1 worker import can still arrive.
                </p>
              </div>
            </div>
          </RadioGroup>

          {requiresConfirmation && (
            <div className="max-w-md space-y-2">
              <Label htmlFor="confirm-s2-authority">
                Type <span className="font-mono">ENABLE S2</span> to confirm the post-cutover change
              </Label>
              <Input
                id="confirm-s2-authority"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="off"
                data-testid="input-confirm-worker-sid-authority-s2"
              />
            </div>
          )}

          <Button
            onClick={() => save.mutate(selected)}
            disabled={!canSave || save.isPending}
            data-testid="button-save-worker-sid-authority"
          >
            {save.isPending ? "Saving…" : "Save authority"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}