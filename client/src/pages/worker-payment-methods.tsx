import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Building2, CreditCard, Loader2, Plus, Star, Trash2 } from "lucide-react";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { apiRequest, getApiErrorMessage, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { hasPaymentGatewayComponent, resolvePaymentGatewayComponent } from "@/plugins/payment-gateway/registry";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type PaymentMethod = {
  id: string;
  gatewayConfigId: string;
  isActive: boolean;
  isDefault: boolean;
  providerError?: string;
  providerDetails?: {
    type?: string;
    card?: { brand: string; last4: string; expMonth: number; expYear: number } | null;
    us_bank_account?: { bank_name: string | null; last4: string; account_type: string | null } | null;
  };
};
type Gateway = { id: string; pluginId: string; name: string | null };
type Consent = { version: string; text: string; accepted: true };
type Setup = { clientSecret: string; componentId: string | null; publicConfig: Record<string, unknown> };

const BASE = "/api/ledger/payment-methods";

function WorkerPaymentMethodsContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const key = [BASE, "worker", worker.id];
  const [addOpen, setAddOpen] = useState(false);
  const [gatewayId, setGatewayId] = useState<string>();
  const [setup, setSetup] = useState<Setup>();
  const [setupLoading, setSetupLoading] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [deleteId, setDeleteId] = useState<string>();

  const methods = useQuery<PaymentMethod[]>({ queryKey: key, queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}`) });
  const gateways = useQuery<Gateway[]>({ queryKey: [...key, "gateways"], queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}/gateways`) });
  const authorization = useQuery<{ authorization: Consent | null }>({
    queryKey: [...key, "authorization"],
    queryFn: () => apiRequest("GET", `${BASE}/worker/${worker.id}/authorization`),
  });

  const resetAdd = () => {
    setAddOpen(false);
    setGatewayId(undefined);
    setSetup(undefined);
    setSetupLoading(false);
    setConsentAccepted(false);
  };
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `${BASE}/worker/${worker.id}/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      setDeleteId(undefined);
      toast({ title: "Payment method removed" });
    },
    onError: (error) => toast({ title: "Could not remove payment method", description: getApiErrorMessage(error, "Please try again."), variant: "destructive" }),
  });
  const setDefault = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `${BASE}/worker/${worker.id}/${id}/set-default`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Default payment method updated" });
    },
    onError: (error) => toast({ title: "Could not set default payment method", description: getApiErrorMessage(error, "Please try again."), variant: "destructive" }),
  });
  const attach = useMutation({
    mutationFn: (methodToken: string) => {
      const consent = authorization.data?.authorization;
      if (!gatewayId || !consent || !consentAccepted) throw new Error("Accept the payment authorization before saving.");
      return apiRequest("POST", `${BASE}/worker/${worker.id}`, { gatewayConfigId: gatewayId, methodToken, consent: { ...consent, accepted: true } });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast({ title: "Payment method added" });
      resetAdd();
    },
    onError: (error) => toast({ title: "Could not save payment method", description: getApiErrorMessage(error, "Please try again."), variant: "destructive" }),
  });

  const startSetup = async (id: string) => {
    const consent = authorization.data?.authorization;
    if (!consent || !consentAccepted) {
      toast({ title: "Authorization required", description: "Accept the payment authorization before continuing.", variant: "destructive" });
      return;
    }
    setGatewayId(id);
    setSetup(undefined);
    setSetupLoading(true);
    try {
      const value = await apiRequest("POST", `${BASE}/worker/${worker.id}/setup`, { gatewayConfigId: id, consent: { ...consent, accepted: true } });
      if (!value || typeof value.clientSecret !== "string" || !value.clientSecret || (value.componentId !== null && typeof value.componentId !== "string")) {
        throw new Error("Payment method setup response is invalid.");
      }
      setSetup({ clientSecret: value.clientSecret, componentId: value.componentId, publicConfig: value.publicConfig ?? {} });
    } catch (error) {
      toast({ title: "Could not start setup", description: getApiErrorMessage(error, "Please try again."), variant: "destructive" });
      setGatewayId(undefined);
    } finally {
      setSetupLoading(false);
    }
  };

  const AddComponent = setup?.componentId && hasPaymentGatewayComponent(setup.componentId)
    ? resolvePaymentGatewayComponent(setup.componentId)
    : null;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div><CardTitle>Payment methods</CardTitle><CardDescription>Manage your saved cards and US bank accounts.</CardDescription></div>
             <Button onClick={() => setAddOpen(true)} disabled={authorization.isError} data-testid="button-worker-add-payment-method"><Plus className="mr-2 h-4 w-4" />Add payment method</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {methods.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> :
            methods.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(methods.error, "Unable to load saved payment methods.")}<Button variant="link" className="h-auto p-0 ml-1" onClick={() => methods.refetch()}>Retry</Button></AlertDescription></Alert> :
            methods.data?.length ? methods.data.map((method) => {
              const card = method.providerDetails?.card;
              const bank = method.providerDetails?.us_bank_account;
              return <div key={method.id} className="flex items-center justify-between gap-3 rounded-lg border p-4" data-testid={`worker-payment-method-${method.id}`}>
                <div className="flex items-center gap-3 min-w-0">
                  {bank ? <Building2 className="h-5 w-5 shrink-0" /> : <CreditCard className="h-5 w-5 shrink-0" />}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span>{card ? `${card.brand} •••• ${card.last4}` : bank ? `${bank.bank_name || "US bank"} •••• ${bank.last4}` : "Payment method"}</span>
                      {method.isDefault && <Badge variant="secondary"><Star className="mr-1 h-3 w-3" />Default</Badge>}
                    </div>
                    {method.providerError && <p className="text-sm text-destructive">{method.providerError}</p>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1">
                  {!method.isDefault && !method.providerError && <Button size="sm" variant="ghost" onClick={() => setDefault.mutate(method.id)} aria-label="Set default"><Star className="h-4 w-4" /></Button>}
                  <Button size="sm" variant="ghost" onClick={() => setDeleteId(method.id)} aria-label="Remove"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>;
            }) : <p className="text-sm text-muted-foreground" data-testid="text-worker-no-payment-methods">No saved payment methods yet.</p>}
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={(open) => open ? setAddOpen(true) : resetAdd()}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add payment method</DialogTitle><DialogDescription>Your sensitive payment details go directly to the payment provider.</DialogDescription></DialogHeader>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} disabled={!authorization.data?.authorization} data-testid="checkbox-worker-method-consent" />
            <span>{authorization.data?.authorization?.text || "Loading payment authorization…"}</span>
          </label>
          {authorization.isError && <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(authorization.error, "You cannot save payment methods.")} <Button variant="link" onClick={() => void authorization.refetch()}>Retry</Button></AlertDescription></Alert>}
          {gateways.isLoading || setupLoading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading secure setup…</div> :
            gateways.isError ? <Alert variant="destructive"><AlertDescription>{getApiErrorMessage(gateways.error, "Unable to load payment providers.")}</AlertDescription></Alert> :
            !setup ? <Select value={gatewayId} onValueChange={(id) => void startSetup(id)}><SelectTrigger data-testid="select-worker-payment-gateway"><SelectValue placeholder="Select a payment provider" /></SelectTrigger><SelectContent>{(gateways.data ?? []).map((gateway) => <SelectItem key={gateway.id} value={gateway.id}>{gateway.name || gateway.pluginId}</SelectItem>)}</SelectContent></Select> :
             AddComponent ? <AddComponent clientSecret={setup.clientSecret} publicConfig={setup.publicConfig} onSuccess={(token) => attach.mutateAsync(token).then(() => undefined)} onCancel={resetAdd} /> :
            <Alert variant="destructive"><AlertDescription>This payment provider is not available.</AlertDescription></Alert>}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(deleteId)} onOpenChange={() => setDeleteId(undefined)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove payment method?</AlertDialogTitle><AlertDialogDescription>You can add it again later.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => deleteId && remove.mutate(deleteId)}>Remove</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function WorkerPaymentMethodsPage() {
  return <WorkerLayout activeTab="payment-methods"><WorkerPaymentMethodsContent /></WorkerLayout>;
}