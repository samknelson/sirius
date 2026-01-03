import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "wouter";
import { Loader2, ArrowLeft, User, FileText, Calendar, CheckCircle, XCircle, Clock, Square, CheckSquare, DollarSign, Shield } from "lucide-react";
import { Cardcheck, CardcheckDefinition, Worker, Contact, BargainingUnit } from "@shared/schema";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessCheck } from "@/hooks/use-access-check";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest, ApiError } from "@/lib/queryClient";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { SignatureModal } from "@/components/esig/SignatureModal";
import { EsigView } from "@/components/esig/EsigView";
import { Checkbox } from "@/components/ui/checkbox";

export default function CardcheckViewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { hasComponent, hasPermission } = useAuth();
  const [signModalOpen, setSignModalOpen] = useState(false);
  const [checkedBoxes, setCheckedBoxes] = useState<Record<number, boolean>>({});
  const [rateValue, setRateValue] = useState<string>("");

  const { data: cardcheck, isLoading, error } = useQuery<Cardcheck>({
    queryKey: ["/api/cardcheck", id],
    enabled: !!id,
  });

  const { data: definition } = useQuery<CardcheckDefinition>({
    queryKey: ["/api/cardcheck/definition", cardcheck?.cardcheckDefinitionId],
    enabled: !!cardcheck?.cardcheckDefinitionId,
  });

  const { data: worker } = useQuery<Worker>({
    queryKey: ["/api/workers", cardcheck?.workerId],
    enabled: !!cardcheck?.workerId,
  });

  const { data: contact } = useQuery<Contact>({
    queryKey: ["/api/contacts", worker?.contactId],
    enabled: !!worker?.contactId,
  });

  // Fetch bargaining unit for the cardcheck (if component enabled and cardcheck has one)
  const { data: bargainingUnit } = useQuery<BargainingUnit>({
    queryKey: ["/api/bargaining-units", cardcheck?.bargainingUnitId],
    enabled: hasComponent("bargainingunits") && !!cardcheck?.bargainingUnitId,
  });

  // Check cardcheck.edit access for this cardcheck
  const { canAccess: hasEditAccess, isLoading: isAccessLoading } = useAccessCheck(
    'cardcheck.edit',
    cardcheck?.id,
    { enabled: !!cardcheck?.id }
  );

  const handleSignSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cardcheck", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/workers", cardcheck?.workerId, "cardchecks"] });
  };

  const requiredCheckboxes: string[] = useMemo(() => {
    return (definition?.data as any)?.checkboxes || [];
  }, [definition]);

  const rateField = useMemo(() => {
    return (definition?.data as any)?.rateField as { title: string; description?: string } | undefined;
  }, [definition]);

  const allCheckboxesChecked = useMemo(() => {
    if (requiredCheckboxes.length === 0) return true;
    return requiredCheckboxes.every((_, index) => checkedBoxes[index] === true);
  }, [requiredCheckboxes, checkedBoxes]);

  const isRateValid = useMemo(() => {
    if (!rateField?.title) return true;
    const numericValue = parseFloat(rateValue);
    return !isNaN(numericValue) && numericValue > 0;
  }, [rateField, rateValue]);

  const canSign = allCheckboxesChecked && isRateValid;

  const escapeHtml = (text: string): string => {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  };

  const buildDocRender = (): string => {
    let docRender = definition?.body || "";
    
    // Include bargaining unit in the signed document if component is enabled and cardcheck has one
    if (hasComponent("bargainingunits") && bargainingUnit) {
      docRender += `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #ddd;"><p style="font-weight: 600; margin-bottom: 8px;">Bargaining Unit:</p><p>${escapeHtml(bargainingUnit.name)}</p></div>`;
    }
    
    if (requiredCheckboxes.length > 0) {
      const checkboxHtml = requiredCheckboxes
        .map((text) => `<div style="margin: 8px 0; display: flex; align-items: flex-start; gap: 8px;"><span style="color: green; font-weight: bold;">&#10003;</span> <span>${escapeHtml(text)}</span></div>`)
        .join("");
      
      docRender += `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #ddd;"><p style="font-weight: 600; margin-bottom: 8px;">Acknowledged Statements:</p>${checkboxHtml}</div>`;
    }
    
    if (rateField?.title && rateValue) {
      const numericRate = parseFloat(rateValue);
      if (!isNaN(numericRate)) {
        docRender += `<div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid #ddd;"><p style="font-weight: 600; margin-bottom: 8px;">${escapeHtml(rateField.title)}:</p><p style="font-size: 1.1em;">$${numericRate.toFixed(2)}</p></div>`;
      }
    }
    
    return docRender;
  };

  const revokeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/cardcheck/${id}`, { status: "revoked" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardcheck", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", cardcheck?.workerId, "cardchecks"] });
      toast({
        title: "Success",
        description: "Cardcheck has been revoked.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to revoke cardcheck.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/cardcheck/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", cardcheck?.workerId, "cardchecks"] });
      toast({
        title: "Success",
        description: "Cardcheck deleted successfully.",
      });
      if (cardcheck?.workerId) {
        setLocation(`/workers/${cardcheck.workerId}/union/cardchecks`);
      } else {
        setLocation("/workers");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete cardcheck.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !cardcheck) {
    // Check if this is an access denied error (403)
    const apiError = error instanceof ApiError ? error : null;
    const errorData = apiError?.data;
    const isAccessDenied = apiError?.status === 403 || errorData?.error === 'ACCESS_DENIED';
    
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            {isAccessDenied ? (
              <>
                <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
                <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
                <p className="text-muted-foreground mb-2">
                  You don't have permission to view this cardcheck.
                </p>
                {errorData?.policy && (
                  <p className="text-sm text-muted-foreground mb-4">
                    Required policy: <code className="bg-muted px-1 py-0.5 rounded">{errorData.policy}</code>
                  </p>
                )}
                {errorData?.message && errorData.message !== 'Access denied' && (
                  <p className="text-sm text-muted-foreground mb-4">
                    Reason: {errorData.message}
                  </p>
                )}
              </>
            ) : (
              <p className="text-destructive">Cardcheck not found.</p>
            )}
            <Link href="/workers">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Workers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check access to view/edit this cardcheck (worker.edit on the associated worker)
  if (isAccessLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (!hasEditAccess) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-semibold mb-2">Access Denied</h2>
            <p className="text-muted-foreground mb-4">
              You don't have permission to view this cardcheck.
            </p>
            <Link href="/workers">
              <Button variant="outline">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Workers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "signed":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "revoked":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "signed":
        return "default";
      case "revoked":
        return "destructive";
      default:
        return "secondary";
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {cardcheck.workerId && (
              <Link href={`/workers/${cardcheck.workerId}/union/cardchecks`}>
                <Button variant="ghost" size="icon" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="heading-cardcheck">
                Cardcheck
              </h1>
              <p className="text-muted-foreground text-sm">
                {definition?.name || "Loading..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon(cardcheck.status)}
            <Badge variant={getStatusBadgeVariant(cardcheck.status)} className="text-sm">
              {cardcheck.status}
            </Badge>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Worker
              </CardTitle>
            </CardHeader>
            <CardContent>
              {worker && contact ? (
                <div className="space-y-2">
                  <p className="font-medium" data-testid="text-worker-name">
                    {contact.displayName}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono">
                    [{worker.siriusId}]
                  </p>
                  {hasComponent("bargainingunits") && (
                    <div className="mt-2">
                      <p className="text-sm text-muted-foreground">Bargaining Unit:</p>
                      <p className="text-sm font-medium" data-testid="text-bargaining-unit">
                        {bargainingUnit?.name || "(None)"}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">Loading worker info...</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Definition
              </CardTitle>
            </CardHeader>
            <CardContent>
              {definition ? (
                <div className="space-y-2">
                  <p className="font-medium" data-testid="text-definition-name">
                    {definition.name}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono">
                    [{definition.siriusId}]
                  </p>
                  {definition.description && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {definition.description}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">Loading definition info...</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className={cardcheck.status === "revoked" ? "border-destructive bg-destructive/5" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Status Details
              {cardcheck.status === "revoked" && (
                <Badge variant="destructive" className="ml-2" data-testid="badge-revoked">
                  Revoked
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <p className={`capitalize ${cardcheck.status === "revoked" ? "text-destructive font-medium" : "text-foreground"}`} data-testid="text-status">
                  {cardcheck.status}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Signed Date</label>
                <p className="text-foreground" data-testid="text-signed-date">
                  {cardcheck.signedDate 
                    ? format(new Date(cardcheck.signedDate), "MMMM d, yyyy 'at' h:mm a") 
                    : "Not signed"}
                </p>
              </div>
              {cardcheck.rate !== null && cardcheck.rate !== undefined && (
                <div className="space-y-1">
                  <label className="text-sm font-medium text-muted-foreground">
                    {rateField?.title || "Rate"}
                  </label>
                  <p className="text-foreground font-medium" data-testid="text-rate-value">
                    ${Number(cardcheck.rate).toFixed(2)}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {cardcheck.esigId ? (
          <EsigView esigId={cardcheck.esigId} />
        ) : (
          <>
            {definition?.body && (
              <Card>
                <CardHeader>
                  <CardTitle>Document Content</CardTitle>
                </CardHeader>
                <CardContent>
                  <div 
                    className="prose prose-sm max-w-none dark:prose-invert"
                    dangerouslySetInnerHTML={{ __html: definition.body }}
                    data-testid="text-body"
                  />
                </CardContent>
              </Card>
            )}

            {cardcheck.status === "pending" && requiredCheckboxes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Required Acknowledgements</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Please review and accept the following statements before signing:
                  </p>
                  {requiredCheckboxes.map((text, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <Checkbox
                        id={`checkbox-${index}`}
                        checked={checkedBoxes[index] || false}
                        onCheckedChange={(checked) => {
                          setCheckedBoxes(prev => ({
                            ...prev,
                            [index]: checked === true
                          }));
                        }}
                        data-testid={`checkbox-acknowledgement-${index + 1}`}
                      />
                      <label 
                        htmlFor={`checkbox-${index}`}
                        className="text-sm leading-relaxed cursor-pointer"
                      >
                        {text}
                      </label>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {cardcheck.status === "pending" && rateField?.title && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    {rateField.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {rateField.description && (
                    <p className="text-sm text-muted-foreground">
                      {rateField.description}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Label htmlFor="rate-input" className="sr-only">{rateField.title}</Label>
                    <span className="text-lg">$</span>
                    <Input
                      id="rate-input"
                      type="number"
                      step="0.01"
                      min="0"
                      value={rateValue}
                      onChange={(e) => setRateValue(e.target.value)}
                      placeholder="0.00"
                      className="max-w-[200px]"
                      data-testid="input-rate"
                    />
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        <Separator />

        <div className="flex items-center gap-2 flex-wrap">
          {cardcheck.status === "pending" && (
            <Button 
              onClick={() => setSignModalOpen(true)}
              disabled={!canSign}
              data-testid="button-sign"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Sign Cardcheck
            </Button>
          )}
          {cardcheck.status === "pending" && !canSign && (
            <span className="text-sm text-muted-foreground">
              {!allCheckboxesChecked && requiredCheckboxes.length > 0 && "Please accept all required acknowledgements"}
              {!allCheckboxesChecked && requiredCheckboxes.length > 0 && !isRateValid && rateField?.title && " and "}
              {!isRateValid && rateField?.title && "enter a valid rate value"}
              {" before signing"}
            </span>
          )}
          
          {cardcheck.status === "signed" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-revoke">
                  <XCircle className="h-4 w-4 mr-2" />
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke Cardcheck?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to revoke this cardcheck? This action can be undone by signing again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => revokeMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Revoke
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          {hasPermission('staff') && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" className="text-destructive" data-testid="button-delete">
                  Delete
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Cardcheck?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete this cardcheck? This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => deleteMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      {id && definition && (
        <SignatureModal
          open={signModalOpen}
          onOpenChange={setSignModalOpen}
          docType="cardcheck"
          docTitle={definition.name}
          docRender={buildDocRender()}
          entityId={id}
          rate={rateField?.title && rateValue ? parseFloat(rateValue) : undefined}
          onSuccess={handleSignSuccess}
        />
      )}
    </div>
  );
}
