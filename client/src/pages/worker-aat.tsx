import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { KeyRound } from "lucide-react";
import type { WorkerAat } from "@shared/schema";

function AccessTokensContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [codeDraft, setCodeDraft] = useState("");
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // The endpoint answers `null` when nothing has been issued yet, so a
  // worker with no row is a normal empty state rather than an error.
  const queryKey = ["/api/workers", worker.id, "aat"];
  const { data: record, isLoading, isError, error } = useQuery<WorkerAat | null>({
    queryKey,
    retry: false,
  });

  // Seed the editable code from the server value whenever it changes
  // (including the first load and after a save).
  const savedCode = record?.accessCode ?? "";
  useEffect(() => {
    setCodeDraft(savedCode);
  }, [savedCode]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const generateMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/workers/${worker.id}/aat/uuid`),
    onSuccess: () => {
      invalidate();
      toast({
        title: "Access token generated",
        description: "A new access UUID has been issued for this worker.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(err, "Failed to generate access token"),
        variant: "destructive",
      });
    },
  });

  const codeMutation = useMutation({
    mutationFn: async (accessCode: string | null) =>
      apiRequest("PUT", `/api/workers/${worker.id}/aat/code`, { accessCode }),
    onSuccess: (_data, accessCode) => {
      invalidate();
      toast({
        title: accessCode ? "Access code saved" : "Access code cleared",
        description: accessCode
          ? "The access code has been updated."
          : "This worker no longer has an access code.",
      });
    },
    onError: (err: unknown) => {
      toast({
        title: "Error",
        description: getApiErrorMessage(err, "Failed to save access code"),
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8">
          <p className="text-muted-foreground text-center" data-testid="text-aat-error">
            {getApiErrorMessage(error, "Failed to load access tokens")}
          </p>
        </CardContent>
      </Card>
    );
  }

  const accessUuid = record?.accessUuid ?? null;
  const hasNothing = !accessUuid && !savedCode;
  const codeDirty = codeDraft.trim() !== savedCode;
  const busy = generateMutation.isPending || codeMutation.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          Access Tokens
        </CardTitle>
        <CardDescription>
          The access UUID and access code for this worker. These are the values a
          future access link will use; they are not used to sign in.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {hasNothing && (
          <p className="text-muted-foreground" data-testid="text-aat-empty">
            No access token has been issued for this worker yet.
          </p>
        )}

        <div className="space-y-2">
          <Label>Access UUID</Label>
          <div className="flex flex-wrap items-center gap-3">
            <code
              className="font-mono text-sm bg-muted rounded px-2 py-1 break-all"
              data-testid="text-access-uuid"
            >
              {accessUuid ?? "Not generated"}
            </code>
            {accessUuid ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setConfirmRegenerate(true)}
                data-testid="button-regenerate-access-uuid"
              >
                Regenerate
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => generateMutation.mutate()}
                data-testid="button-generate-access-uuid"
              >
                Generate
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="access-code">Access Code</Label>
          <div className="flex flex-wrap items-center gap-3">
            <Input
              id="access-code"
              className="max-w-xs"
              value={codeDraft}
              placeholder="Not set"
              disabled={busy}
              onChange={(e) => setCodeDraft(e.target.value)}
              data-testid="input-access-code"
            />
            <Button
              size="sm"
              disabled={busy || !codeDirty}
              onClick={() => codeMutation.mutate(codeDraft.trim() || null)}
              data-testid="button-save-access-code"
            >
              Save
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !savedCode}
              onClick={() => codeMutation.mutate(null)}
              data-testid="button-clear-access-code"
            >
              Clear
            </Button>
          </div>
        </div>
      </CardContent>

      <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
        <AlertDialogContent data-testid="dialog-confirm-regenerate">
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate access UUID?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces the current access UUID with a new one. Any link
              already handed out to this worker will stop working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-regenerate">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => generateMutation.mutate()}
              data-testid="button-confirm-regenerate"
            >
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function WorkerAatPage() {
  return (
    <WorkerLayout activeTab="aat">
      <AccessTokensContent />
    </WorkerLayout>
  );
}
