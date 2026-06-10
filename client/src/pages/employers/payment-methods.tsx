import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Plus, Trash2, Check, X, Star, Loader2, Building2, ExternalLink, Eye } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  hasPaymentGatewayComponent,
  resolvePaymentGatewayComponent,
} from "@/plugins/payment-gateway/registry";

const ENTITY_TYPE = "employer";
const PM_BASE = "/api/ledger/payment-methods";

interface PaymentMethod {
  id: string;
  entityType: string;
  entityId: string;
  paymentMethod: string;
  gatewayConfigId: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  providerDetails?: {
    type: string;
    card?: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    } | null;
    us_bank_account?: {
      bank_name: string | null;
      last4: string;
      account_holder_type: string | null;
      account_type: string | null;
    } | null;
    billing_details?: {
      name: string | null;
      email: string | null;
    };
  };
  providerError?: string;
}

interface GatewayOption {
  id: string;
  pluginId: string;
  name: string | null;
}

interface SetupResponse {
  clientSecret: string;
  componentId: string | null;
  publicConfig: Record<string, unknown>;
}

function PaymentMethodsContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const entityId = employer.id;
  const listKey = [PM_BASE, ENTITY_TYPE, entityId];

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [paymentMethodToDelete, setPaymentMethodToDelete] = useState<PaymentMethod | null>(null);

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedGatewayId, setSelectedGatewayId] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [addComponentId, setAddComponentId] = useState<string | null>(null);
  const [publicConfig, setPublicConfig] = useState<Record<string, unknown>>({});
  const [isLoadingSetup, setIsLoadingSetup] = useState(false);
  const [confirmedMethodToken, setConfirmedMethodToken] = useState<string | null>(null);

  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [providerDetails, setProviderDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { data: paymentMethods, isLoading, error } = useQuery<PaymentMethod[]>({
    queryKey: listKey,
    enabled: !!entityId,
  });

  const { data: gateways } = useQuery<GatewayOption[]>({
    queryKey: [PM_BASE, ENTITY_TYPE, entityId, "gateways"],
    enabled: !!entityId,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest("PATCH", `${PM_BASE}/${ENTITY_TYPE}/${entityId}/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Success", description: "Payment method updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update payment method",
        variant: "destructive",
      });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("POST", `${PM_BASE}/${ENTITY_TYPE}/${entityId}/${id}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Success", description: "Default payment method updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to set default payment method",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `${PM_BASE}/${ENTITY_TYPE}/${entityId}/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Success", description: "Payment method deleted successfully" });
      setDeleteDialogOpen(false);
      setPaymentMethodToDelete(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete payment method",
        variant: "destructive",
      });
    },
  });

  const addPaymentMethodMutation = useMutation({
    mutationFn: async ({ gatewayConfigId, methodToken }: { gatewayConfigId: string; methodToken: string }) => {
      return apiRequest("POST", `${PM_BASE}/${ENTITY_TYPE}/${entityId}`, { gatewayConfigId, methodToken });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: listKey });
      toast({ title: "Success", description: "Payment method added successfully" });
      resetAddDialog();
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save payment method. You can retry.",
        variant: "destructive",
      });
    },
  });

  const resetAddDialog = () => {
    setAddDialogOpen(false);
    setSelectedGatewayId(null);
    setClientSecret(null);
    setAddComponentId(null);
    setPublicConfig({});
    setConfirmedMethodToken(null);
  };

  const handleDelete = (pm: PaymentMethod) => {
    setPaymentMethodToDelete(pm);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (paymentMethodToDelete) {
      deleteMutation.mutate(paymentMethodToDelete.id);
    }
  };

  const handleOpenAddDialog = () => {
    setAddDialogOpen(true);
    setConfirmedMethodToken(null);
    setClientSecret(null);
    // Auto-select the only gateway, otherwise let the user pick.
    if (gateways && gateways.length === 1) {
      void startSetup(gateways[0].id);
    } else {
      setSelectedGatewayId(null);
    }
  };

  const startSetup = async (gatewayConfigId: string) => {
    setSelectedGatewayId(gatewayConfigId);
    setIsLoadingSetup(true);
    try {
      const data: SetupResponse = await apiRequest("POST", `${PM_BASE}/${ENTITY_TYPE}/${entityId}/setup`, {
        gatewayConfigId,
      });
      setClientSecret(data.clientSecret);
      setAddComponentId(data.componentId);
      setPublicConfig(data.publicConfig ?? {});
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to initialize payment method setup",
        variant: "destructive",
      });
      resetAddDialog();
    } finally {
      setIsLoadingSetup(false);
    }
  };

  const handlePaymentMethodSuccess = (methodToken: string) => {
    if (!selectedGatewayId) return;
    setConfirmedMethodToken(methodToken);
    addPaymentMethodMutation.mutate({ gatewayConfigId: selectedGatewayId, methodToken });
  };

  const handleRetryAttachment = () => {
    if (confirmedMethodToken && selectedGatewayId) {
      addPaymentMethodMutation.mutate({ gatewayConfigId: selectedGatewayId, methodToken: confirmedMethodToken });
    }
  };

  const formatCardBrand = (brand: string) => brand.charAt(0).toUpperCase() + brand.slice(1);

  const handleViewDetails = async (pm: PaymentMethod) => {
    setDetailsDialogOpen(true);
    setLoadingDetails(true);
    setProviderDetails(null);

    try {
      const data = await apiRequest("GET", `${PM_BASE}/${ENTITY_TYPE}/${entityId}/${pm.id}/details`);
      setProviderDetails(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to load payment method details",
        variant: "destructive",
      });
      setDetailsDialogOpen(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const AddComponent =
    addComponentId && hasPaymentGatewayComponent(addComponentId)
      ? resolvePaymentGatewayComponent(addComponentId)
      : null;

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
          <CardDescription>Manage customer payment methods</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    const serverMessage = (error as any)?.data?.message as string | undefined;
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
          <CardDescription>Manage customer payment methods</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription data-testid="text-payment-methods-error">
              {serverMessage
                ? `Failed to load payment methods: ${serverMessage}`
                : "Failed to load payment methods. Please try again later."}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const hasGateways = !!gateways && gateways.length > 0;

  // Group the loaded methods by their gateway so the list can render one
  // section per gateway (in configured order). Done entirely client-side: both
  // the methods (each carrying gatewayConfigId) and the gateways list are
  // already loaded, so no extra backend calls are needed.
  const methodsByGateway = new Map<string, PaymentMethod[]>();
  for (const pm of paymentMethods ?? []) {
    const bucket = methodsByGateway.get(pm.gatewayConfigId);
    if (bucket) bucket.push(pm);
    else methodsByGateway.set(pm.gatewayConfigId, [pm]);
  }
  const gatewayLabel = (g: GatewayOption) =>
    g.name?.trim() || g.pluginId.charAt(0).toUpperCase() + g.pluginId.slice(1);
  const methodSections: { id: string; title: string; methods: PaymentMethod[] }[] = [];
  // Configured gateways first, in their configured order; skip those with none.
  for (const g of gateways ?? []) {
    const methods = methodsByGateway.get(g.id);
    if (methods && methods.length > 0) {
      methodSections.push({ id: g.id, title: gatewayLabel(g), methods });
    }
  }
  // Any methods whose gateway is missing from the list (e.g. a since-removed
  // gateway) still get shown so nothing is silently hidden.
  const knownGatewayIds = new Set((gateways ?? []).map((g) => g.id));
  methodsByGateway.forEach((methods, gatewayId) => {
    if (!knownGatewayIds.has(gatewayId) && methods.length > 0) {
      methodSections.push({ id: gatewayId, title: "Other gateway", methods });
    }
  });

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment Methods</CardTitle>
              <CardDescription>Manage saved payment methods for this employer</CardDescription>
            </div>
            <Button
              data-testid="button-add-payment-method"
              onClick={handleOpenAddDialog}
              disabled={!hasGateways}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Payment Method
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!hasGateways && (
            <Alert className="mb-6" variant="destructive">
              <AlertDescription data-testid="text-no-gateways">
                No payment gateway is configured. Please contact your administrator to set one up.
              </AlertDescription>
            </Alert>
          )}

          <Alert className="mb-6">
            <AlertDescription>
              Add payment methods securely. Sensitive details are handled directly by the payment
              provider and are never stored on our servers.
            </AlertDescription>
          </Alert>

          {!paymentMethods || paymentMethods.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <CreditCard className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">No Payment Methods</h3>
              <p className="text-muted-foreground text-center max-w-md" data-testid="text-no-payment-methods">
                No payment methods have been added yet. Add a payment method to enable payments.
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {methodSections.map((section) => (
                <div key={section.id} data-testid={`gateway-section-${section.id}`}>
                  <h3
                    className="text-sm font-semibold text-foreground mb-3"
                    data-testid={`text-gateway-name-${section.id}`}
                  >
                    {section.title}
                  </h3>
                  <div className="space-y-4">
                    {section.methods.map((pm) => (
                <div
                  key={pm.id}
                  className={`border rounded-lg p-4 ${!pm.isActive ? "bg-muted/30" : ""}`}
                  data-testid={`payment-method-${pm.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                        {pm.providerDetails?.type === "us_bank_account" || pm.providerDetails?.us_bank_account ? (
                          <Building2 className="text-primary" size={24} />
                        ) : (
                          <CreditCard className="text-primary" size={24} />
                        )}
                      </div>
                      <div>
                        {pm.providerDetails?.card ? (
                          <>
                            <div className="flex items-center space-x-2 mb-1">
                              <h4 className="font-medium">
                                {formatCardBrand(pm.providerDetails.card.brand)} •••• {pm.providerDetails.card.last4}
                              </h4>
                              {pm.isDefault && (
                                <Badge variant="secondary" className="flex items-center space-x-1">
                                  <Star className="h-3 w-3" />
                                  <span>Default</span>
                                </Badge>
                              )}
                              {!pm.isActive && <Badge variant="outline">Disabled</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Expires {pm.providerDetails.card.expMonth}/{pm.providerDetails.card.expYear}
                            </p>
                            {pm.providerDetails.billing_details?.name && (
                              <p className="text-sm text-muted-foreground">
                                {pm.providerDetails.billing_details.name}
                              </p>
                            )}
                          </>
                        ) : pm.providerDetails?.us_bank_account ? (
                          <>
                            <div className="flex items-center space-x-2 mb-1">
                              <h4 className="font-medium">
                                {pm.providerDetails.us_bank_account.bank_name || "Bank Account"} ••••{" "}
                                {pm.providerDetails.us_bank_account.last4}
                              </h4>
                              {pm.isDefault && (
                                <Badge variant="secondary" className="flex items-center space-x-1">
                                  <Star className="h-3 w-3" />
                                  <span>Default</span>
                                </Badge>
                              )}
                              {!pm.isActive && <Badge variant="outline">Disabled</Badge>}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {pm.providerDetails.us_bank_account.account_type === "checking" ? "Checking" : "Savings"} Account
                              {pm.providerDetails.us_bank_account.account_holder_type &&
                                ` • ${pm.providerDetails.us_bank_account.account_holder_type === "individual" ? "Individual" : "Company"}`}
                            </p>
                            {pm.providerDetails.billing_details?.name && (
                              <p className="text-sm text-muted-foreground">
                                {pm.providerDetails.billing_details.name}
                              </p>
                            )}
                          </>
                        ) : pm.providerError ? (
                          <>
                            <h4 className="font-medium text-destructive">Error Loading Payment Method</h4>
                            <p className="text-sm text-muted-foreground">{pm.providerError}</p>
                          </>
                        ) : (
                          <>
                            <h4 className="font-medium">Payment Method</h4>
                            <p className="text-sm text-muted-foreground">{pm.paymentMethod}</p>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      {pm.isActive ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleActiveMutation.mutate({ id: pm.id, isActive: false })}
                          disabled={toggleActiveMutation.isPending}
                          data-testid={`button-disable-${pm.id}`}
                        >
                          <X className="mr-2 h-4 w-4" />
                          Disable
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleActiveMutation.mutate({ id: pm.id, isActive: true })}
                          disabled={toggleActiveMutation.isPending}
                          data-testid={`button-enable-${pm.id}`}
                        >
                          <Check className="mr-2 h-4 w-4" />
                          Enable
                        </Button>
                      )}
                      {!pm.isDefault && pm.isActive && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setDefaultMutation.mutate(pm.id)}
                          disabled={setDefaultMutation.isPending}
                          data-testid={`button-set-default-${pm.id}`}
                        >
                          <Star className="mr-2 h-4 w-4" />
                          Set Default
                        </Button>
                      )}
                      {!pm.providerError && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewDetails(pm)}
                          data-testid={`button-view-details-${pm.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDelete(pm)}
                        disabled={deleteMutation.isPending}
                        data-testid={`button-delete-${pm.id}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment Method</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this payment method? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPaymentMethodToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Payment Method Details</DialogTitle>
            <DialogDescription>Complete information from the payment provider</DialogDescription>
          </DialogHeader>

          {loadingDetails ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : providerDetails ? (
            <div className="space-y-4">
              {providerDetails.providerUrl && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(providerDetails.providerUrl, "_blank")}
                    data-testid="button-view-in-provider"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View in Provider Dashboard
                  </Button>
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Basic Information</h4>
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ID:</span>
                      <span className="font-mono">{providerDetails.paymentMethod.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <span className="capitalize">{providerDetails.paymentMethod.type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{new Date(providerDetails.paymentMethod.created * 1000).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Live Mode:</span>
                      <span>{providerDetails.paymentMethod.livemode ? "Yes" : "No (Test Mode)"}</span>
                    </div>
                  </div>
                </div>

                {providerDetails.paymentMethod.card && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Card Details</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Brand:</span>
                        <span className="capitalize">{providerDetails.paymentMethod.card.brand}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last 4 Digits:</span>
                        <span>{providerDetails.paymentMethod.card.last4}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Expiration:</span>
                        <span>{providerDetails.paymentMethod.card.exp_month}/{providerDetails.paymentMethod.card.exp_year}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Funding:</span>
                        <span className="capitalize">{providerDetails.paymentMethod.card.funding}</span>
                      </div>
                      {providerDetails.paymentMethod.card.country && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Country:</span>
                          <span>{providerDetails.paymentMethod.card.country}</span>
                        </div>
                      )}
                      {providerDetails.paymentMethod.card.fingerprint && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Fingerprint:</span>
                          <span className="font-mono text-xs">{providerDetails.paymentMethod.card.fingerprint}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {providerDetails.paymentMethod.us_bank_account && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Bank Account Details</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      {providerDetails.paymentMethod.us_bank_account.bank_name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Bank:</span>
                          <span>{providerDetails.paymentMethod.us_bank_account.bank_name}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last 4 Digits:</span>
                        <span>{providerDetails.paymentMethod.us_bank_account.last4}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account Type:</span>
                        <span className="capitalize">{providerDetails.paymentMethod.us_bank_account.account_type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account Holder:</span>
                        <span className="capitalize">{providerDetails.paymentMethod.us_bank_account.account_holder_type}</span>
                      </div>
                      {providerDetails.paymentMethod.us_bank_account.routing_number && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Routing Number:</span>
                          <span>{providerDetails.paymentMethod.us_bank_account.routing_number}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {providerDetails.paymentMethod.billing_details && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Billing Details</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      {providerDetails.paymentMethod.billing_details.name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Name:</span>
                          <span>{providerDetails.paymentMethod.billing_details.name}</span>
                        </div>
                      )}
                      {providerDetails.paymentMethod.billing_details.email && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Email:</span>
                          <span>{providerDetails.paymentMethod.billing_details.email}</span>
                        </div>
                      )}
                      {providerDetails.paymentMethod.billing_details.phone && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Phone:</span>
                          <span>{providerDetails.paymentMethod.billing_details.phone}</span>
                        </div>
                      )}
                      {providerDetails.paymentMethod.billing_details.address && (
                        <div>
                          <span className="text-muted-foreground block mb-1">Address:</span>
                          <div className="pl-4 text-sm">
                            {providerDetails.paymentMethod.billing_details.address.line1 && (
                              <div>{providerDetails.paymentMethod.billing_details.address.line1}</div>
                            )}
                            {providerDetails.paymentMethod.billing_details.address.line2 && (
                              <div>{providerDetails.paymentMethod.billing_details.address.line2}</div>
                            )}
                            {(providerDetails.paymentMethod.billing_details.address.city ||
                              providerDetails.paymentMethod.billing_details.address.state ||
                              providerDetails.paymentMethod.billing_details.address.postal_code) && (
                              <div>
                                {providerDetails.paymentMethod.billing_details.address.city}
                                {providerDetails.paymentMethod.billing_details.address.city &&
                                  providerDetails.paymentMethod.billing_details.address.state &&
                                  ", "}
                                {providerDetails.paymentMethod.billing_details.address.state}{" "}
                                {providerDetails.paymentMethod.billing_details.address.postal_code}
                              </div>
                            )}
                            {providerDetails.paymentMethod.billing_details.address.country && (
                              <div>{providerDetails.paymentMethod.billing_details.address.country}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {providerDetails.paymentMethod.metadata &&
                  Object.keys(providerDetails.paymentMethod.metadata).length > 0 && (
                    <div>
                      <h4 className="text-sm font-semibold mb-2">Metadata</h4>
                      <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                        {Object.entries(providerDetails.paymentMethod.metadata).map(([key, value]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-muted-foreground">{key}:</span>
                            <span>{String(value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={addDialogOpen} onOpenChange={(open) => (open ? setAddDialogOpen(true) : resetAddDialog())}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Payment Method</DialogTitle>
            <DialogDescription>
              {confirmedMethodToken
                ? "Saving payment method..."
                : clientSecret
                ? "Enter your payment details to add a new payment method."
                : "Choose a payment gateway to continue."}
            </DialogDescription>
          </DialogHeader>

          {confirmedMethodToken ? (
            <div className="space-y-4 py-4">
              {addPaymentMethodMutation.isPending ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">Saving payment method...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>Failed to save payment method. You can retry or cancel.</AlertDescription>
                  </Alert>
                  <div className="flex space-x-2">
                    <Button variant="outline" onClick={resetAddDialog}>
                      Cancel
                    </Button>
                    <Button onClick={handleRetryAttachment} data-testid="button-retry-payment-method">
                      Retry
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : isLoadingSetup ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : !clientSecret ? (
            <div className="space-y-4 py-2">
              <Select value={selectedGatewayId ?? undefined} onValueChange={(v) => void startSetup(v)}>
                <SelectTrigger data-testid="select-gateway">
                  <SelectValue placeholder="Select a payment gateway" />
                </SelectTrigger>
                <SelectContent>
                  {(gateways ?? []).map((g) => (
                    <SelectItem key={g.id} value={g.id} data-testid={`select-gateway-${g.id}`}>
                      {g.name || g.pluginId}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : AddComponent ? (
            <AddComponent
              clientSecret={clientSecret}
              publicConfig={publicConfig}
              onSuccess={handlePaymentMethodSuccess}
              onCancel={resetAddDialog}
            />
          ) : (
            <div className="p-4 border border-yellow-200 bg-yellow-50 rounded">
              <p className="text-sm text-yellow-800">
                This payment provider does not have an add-payment-method form available.
              </p>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={resetAddDialog}>
                  Close
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function PaymentMethodsPage() {
  return (
    <EmployerLayout activeTab="payment-methods">
      <PaymentMethodsContent />
    </EmployerLayout>
  );
}
