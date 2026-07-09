import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Users,
  Search,
  Trash2,
  FileUp,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type { WizardStepComponentProps } from "@/components/wizards/framework/types";

interface DependentEntry {
  relationId: string;
  workerId: string;
  name: string;
  ssnLast4: string;
  birthDate: string;
  relationTypeId: string;
  matchedExisting: boolean;
  documentFileId: string;
  documentFileName: string | null;
}

interface LookupResult {
  status: "matched" | "dob_mismatch" | "no_match";
  workerId?: string;
  name?: string;
  message: string;
}

interface RelationTypeOption {
  id: string;
  name: string;
}

/**
 * Step 3 (optional, repeatable): add dependents. Flow per dependent:
 * SSN + DoB lookup → (if new) name entry → relationship type →
 * supporting document upload → Add. Records are created immediately.
 */
export function DependentsStep({
  wizardId,
  step,
  data,
}: WizardStepComponentProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const dependents: DependentEntry[] = Array.isArray(data?.dependents)
    ? (data.dependents as DependentEntry[])
    : [];
  const lookup = (data?.dependentLookup as LookupResult | null) ?? null;
  const pendingDocument =
    (data?.pendingDocument as { fileId: string; fileName: string } | null) ??
    null;

  const [ssn, setSsn] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [given, setGiven] = useState("");
  const [family, setFamily] = useState("");
  const [relationTypeId, setRelationTypeId] = useState("");

  const { data: relationTypes } = useQuery<RelationTypeOption[]>({
    queryKey: ["/api/options/worker-relation-type"],
  });

  const submitUrl = `/api/wizards/${wizardId}/dispatch/${step.id}/submit`;
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: [`/api/wizards/${wizardId}`] });
  const onError = (error: Error) =>
    toast({ title: "Error", description: error.message, variant: "destructive" });

  const lookupMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", submitUrl, {
        input: { action: "lookup", ssn, birthDate },
      }),
    onSuccess: invalidate,
    onError,
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(
        `/api/wizards/${wizardId}/dispatch/${step.id}/upload`,
        { method: "POST", body: formData, credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || "Upload failed");
      }
      return res.json();
    },
    onSuccess: invalidate,
    onError,
  });

  const addMutation = useMutation({
    mutationFn: async () =>
      apiRequest("POST", submitUrl, {
        input: {
          action: "add",
          ssn,
          birthDate,
          given,
          family,
          relationTypeId,
          documentFileId: pendingDocument?.fileId,
        },
      }),
    onSuccess: () => {
      invalidate();
      setSsn("");
      setBirthDate("");
      setGiven("");
      setFamily("");
      setRelationTypeId("");
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Dependent added" });
    },
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: async (relationId: string) =>
      apiRequest("POST", submitUrl, {
        input: { action: "remove", relationId },
      }),
    onSuccess: invalidate,
    onError,
  });

  const needsName = lookup?.status === "no_match";
  const canAdd =
    !!lookup &&
    lookup.status !== "dob_mismatch" &&
    !!relationTypeId &&
    !!pendingDocument &&
    (!needsName || (given.trim() && family.trim()));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Users className="text-primary" size={20} />
          </div>
          <div>
            <CardTitle>Dependents</CardTitle>
            <CardDescription>
              Optionally add dependents (spouse, children). Each dependent is
              matched by SSN and date of birth and requires a supporting
              document.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {dependents.length > 0 && (
          <div className="space-y-2">
            {dependents.map((dep) => (
              <div
                key={dep.relationId}
                className="flex items-center gap-3 rounded-lg border p-3"
                data-testid={`row-dependent-${dep.relationId}`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {dep.name}
                    {dep.matchedExisting && (
                      <Badge variant="secondary">Existing worker</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    SSN ***-**-{dep.ssnLast4} · DoB {dep.birthDate}
                    {dep.documentFileName ? ` · ${dep.documentFileName}` : ""}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeMutation.mutate(dep.relationId)}
                  disabled={removeMutation.isPending}
                  data-testid={`button-remove-dependent-${dep.relationId}`}
                >
                  <Trash2 size={16} />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="rounded-lg border p-4 space-y-4">
          <h4 className="font-medium">Add a dependent</h4>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="dep-ssn">SSN</Label>
              <Input
                id="dep-ssn"
                value={ssn}
                onChange={(e) => setSsn(e.target.value)}
                placeholder="123-45-6789"
                data-testid="input-dependent-ssn"
              />
            </div>
            <div>
              <Label htmlFor="dep-dob">Date of birth</Label>
              <Input
                id="dep-dob"
                type="date"
                value={birthDate}
                onChange={(e) => setBirthDate(e.target.value)}
                data-testid="input-dependent-dob"
              />
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => lookupMutation.mutate()}
            disabled={!ssn || !birthDate || lookupMutation.isPending}
            data-testid="button-lookup-dependent"
          >
            <Search size={16} className="mr-2" />
            {lookupMutation.isPending ? "Checking…" : "Check for existing record"}
          </Button>

          {lookup && (
            <Alert
              variant={lookup.status === "dob_mismatch" ? "destructive" : "default"}
              data-testid="alert-dependent-lookup"
            >
              {lookup.status === "dob_mismatch" ? (
                <AlertTriangle className="h-4 w-4" />
              ) : (
                <CheckCircle2 className="h-4 w-4" />
              )}
              <AlertDescription>{lookup.message}</AlertDescription>
            </Alert>
          )}

          {lookup && lookup.status !== "dob_mismatch" && (
            <div className="space-y-4">
              {needsName && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="dep-given">First name</Label>
                    <Input
                      id="dep-given"
                      value={given}
                      onChange={(e) => setGiven(e.target.value)}
                      data-testid="input-dependent-given"
                    />
                  </div>
                  <div>
                    <Label htmlFor="dep-family">Last name</Label>
                    <Input
                      id="dep-family"
                      value={family}
                      onChange={(e) => setFamily(e.target.value)}
                      data-testid="input-dependent-family"
                    />
                  </div>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Relationship</Label>
                  <Select value={relationTypeId} onValueChange={setRelationTypeId}>
                    <SelectTrigger data-testid="select-relation-type">
                      <SelectValue placeholder="Select relationship…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(relationTypes ?? []).map((rt) => (
                        <SelectItem key={rt.id} value={rt.id}>
                          {rt.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="dep-doc">Supporting document</Label>
                  <Input
                    id="dep-doc"
                    type="file"
                    ref={fileInputRef}
                    accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadMutation.mutate(file);
                    }}
                    data-testid="input-dependent-document"
                  />
                  {uploadMutation.isPending && (
                    <p className="text-xs text-muted-foreground mt-1">Uploading…</p>
                  )}
                  {pendingDocument && (
                    <p
                      className="text-xs text-muted-foreground mt-1 flex items-center gap-1"
                      data-testid="text-pending-document"
                    >
                      <FileUp size={12} /> {pendingDocument.fileName}
                    </p>
                  )}
                </div>
              </div>
              <Button
                onClick={() => addMutation.mutate()}
                disabled={!canAdd || addMutation.isPending}
                data-testid="button-add-dependent"
              >
                {addMutation.isPending ? "Adding…" : "Add Dependent"}
              </Button>
              {!pendingDocument && (
                <p className="text-xs text-muted-foreground">
                  A supporting document (e.g. marriage or birth certificate) is
                  required before the dependent can be added.
                </p>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
