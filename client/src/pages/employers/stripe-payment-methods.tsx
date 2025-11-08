import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CreditCard, Plus, Trash2, Check, X, Star, Loader2, Building2, ExternalLink, Eye } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import PaymentMethodCollector from "@/components/stripe/PaymentMethodCollector";

interface PaymentMethod {
  id: string;
  entityType: string;
  entityId: string;
  paymentMethod: string;
  isActive: boolean;
  isDefault: boolean;
  createdAt: string;
  stripeDetails?: {
    type: string;
    card?: {
      brand: string;
      last4: string;
      expMonth: number;
      expYear: number;
    };
    us_bank_account?: {
      bank_name: string | null;
      last4: string;
      account_holder_type: string;
      account_type: string;
    };
    billing_details?: {
      name: string | null;
      email: string | null;
    };
  };
  stripeError?: string;
}

function PaymentMethodsContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [paymentMethodToDelete, setPaymentMethodToDelete] = useState<PaymentMethod | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [isLoadingSetupIntent, setIsLoadingSetupIntent] = useState(false);
  const [confirmedPaymentMethodId, setConfirmedPaymentMethodId] = useState<string | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [selectedPaymentMethodForDetails, setSelectedPaymentMethodForDetails] = useState<PaymentMethod | null>(null);
  const [stripePaymentMethodDetails, setStripePaymentMethodDetails] = useState<any>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const { data: paymentMethods, isLoading, error } = useQuery<PaymentMethod[]>({
    queryKey: ['/api/employers', employer.id, 'ledger', 'stripe', 'payment-methods'],
    enabled: !!employer.id,
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      return apiRequest('PATCH', `/api/employers/${employer.id}/ledger/stripe/payment-methods/${id}`, { isActive });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/employers', employer.id, 'ledger', 'stripe', 'payment-methods'] });
      toast({
        title: "Success",
        description: "Payment method updated successfully",
      });
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
      return apiRequest('POST', `/api/employers/${employer.id}/ledger/stripe/payment-methods/${id}/set-default`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/employers', employer.id, 'ledger', 'stripe', 'payment-methods'] });
      toast({
        title: "Success",
        description: "Default payment method updated successfully",
      });
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
      return apiRequest('DELETE', `/api/employers/${employer.id}/ledger/stripe/payment-methods/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/employers', employer.id, 'ledger', 'stripe', 'payment-methods'] });
      toast({
        title: "Success",
        description: "Payment method deleted successfully",
      });
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
    mutationFn: async (paymentMethodId: string) => {
      return apiRequest('POST', `/api/employers/${employer.id}/ledger/stripe/payment-methods`, { paymentMethodId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/employers', employer.id, 'ledger', 'stripe', 'payment-methods'] });
      toast({
        title: "Success",
        description: "Payment method added successfully",
      });
      setAddDialogOpen(false);
      setClientSecret(null);
      setConfirmedPaymentMethodId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to save payment method. You can retry.",
        variant: "destructive",
      });
    },
  });

  const handleDelete = (pm: PaymentMethod) => {
    setPaymentMethodToDelete(pm);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (paymentMethodToDelete) {
      deleteMutation.mutate(paymentMethodToDelete.id);
    }
  };

  const handleOpenAddDialog = async () => {
    setIsLoadingSetupIntent(true);
    setAddDialogOpen(true);
    
    try {
      const response = await apiRequest('POST', `/api/employers/${employer.id}/ledger/stripe/setup-intent`);
      const data = await response.json();
      setClientSecret(data.clientSecret);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to initialize payment method setup",
        variant: "destructive",
      });
      setAddDialogOpen(false);
    } finally {
      setIsLoadingSetupIntent(false);
    }
  };

  const handlePaymentMethodSuccess = (paymentMethodId: string) => {
    // Cache the payment method ID from Stripe so we can retry if backend fails
    setConfirmedPaymentMethodId(paymentMethodId);
    addPaymentMethodMutation.mutate(paymentMethodId);
  };

  const handleRetryAttachment = () => {
    if (confirmedPaymentMethodId) {
      addPaymentMethodMutation.mutate(confirmedPaymentMethodId);
    }
  };

  const handleCancelAddPaymentMethod = () => {
    setAddDialogOpen(false);
    setClientSecret(null);
    setConfirmedPaymentMethodId(null);
  };

  const formatCardBrand = (brand: string) => {
    return brand.charAt(0).toUpperCase() + brand.slice(1);
  };

  const handleViewDetails = async (pm: PaymentMethod) => {
    setSelectedPaymentMethodForDetails(pm);
    setDetailsDialogOpen(true);
    setLoadingDetails(true);
    setStripePaymentMethodDetails(null);
    
    try {
      const response = await apiRequest('GET', `/api/employers/${employer.id}/ledger/stripe/payment-methods/${pm.id}/details`);
      const data = await response.json();
      setStripePaymentMethodDetails(data);
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
    return (
      <Card>
        <CardHeader>
          <CardTitle>Payment Methods</CardTitle>
          <CardDescription>Manage customer payment methods</CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load payment methods. Please try again later.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Payment Methods</CardTitle>
              <CardDescription>Manage saved payment methods for this employer</CardDescription>
            </div>
            <Button data-testid="button-add-payment-method" onClick={handleOpenAddDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Add Payment Method
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <Alert className="mb-6">
            <AlertDescription>
              Add payment methods securely using Stripe's payment form. Card details are handled directly by Stripe and never stored on our servers.
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
            <div className="space-y-4">
              {paymentMethods.map((pm) => (
                <div
                  key={pm.id}
                  className={`border rounded-lg p-4 ${!pm.isActive ? 'bg-muted/30' : ''}`}
                  data-testid={`payment-method-${pm.id}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 bg-primary/10 rounded-lg flex items-center justify-center">
                        {pm.stripeDetails?.type === 'us_bank_account' || pm.stripeDetails?.us_bank_account ? (
                          <Building2 className="text-primary" size={24} />
                        ) : (
                          <CreditCard className="text-primary" size={24} />
                        )}
                      </div>
                      <div>
                        {pm.stripeDetails?.card ? (
                          <>
                            <div className="flex items-center space-x-2 mb-1">
                              <h4 className="font-medium">
                                {formatCardBrand(pm.stripeDetails.card.brand)} •••• {pm.stripeDetails.card.last4}
                              </h4>
                              {pm.isDefault && (
                                <Badge variant="secondary" className="flex items-center space-x-1">
                                  <Star className="h-3 w-3" />
                                  <span>Default</span>
                                </Badge>
                              )}
                              {!pm.isActive && (
                                <Badge variant="outline">Disabled</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              Expires {pm.stripeDetails.card.expMonth}/{pm.stripeDetails.card.expYear}
                            </p>
                            {pm.stripeDetails.billing_details?.name && (
                              <p className="text-sm text-muted-foreground">
                                {pm.stripeDetails.billing_details.name}
                              </p>
                            )}
                          </>
                        ) : pm.stripeDetails?.us_bank_account ? (
                          <>
                            <div className="flex items-center space-x-2 mb-1">
                              <h4 className="font-medium">
                                {pm.stripeDetails.us_bank_account.bank_name || 'Bank Account'} •••• {pm.stripeDetails.us_bank_account.last4}
                              </h4>
                              {pm.isDefault && (
                                <Badge variant="secondary" className="flex items-center space-x-1">
                                  <Star className="h-3 w-3" />
                                  <span>Default</span>
                                </Badge>
                              )}
                              {!pm.isActive && (
                                <Badge variant="outline">Disabled</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {pm.stripeDetails.us_bank_account.account_type === 'checking' ? 'Checking' : 'Savings'} Account
                              {pm.stripeDetails.us_bank_account.account_holder_type && ` • ${pm.stripeDetails.us_bank_account.account_holder_type === 'individual' ? 'Individual' : 'Company'}`}
                            </p>
                            {pm.stripeDetails.billing_details?.name && (
                              <p className="text-sm text-muted-foreground">
                                {pm.stripeDetails.billing_details.name}
                              </p>
                            )}
                          </>
                        ) : pm.stripeError ? (
                          <>
                            <h4 className="font-medium text-destructive">Error Loading Payment Method</h4>
                            <p className="text-sm text-muted-foreground">{pm.stripeError}</p>
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
                      {!pm.stripeError && (
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
            <AlertDialogCancel onClick={() => setPaymentMethodToDelete(null)}>
              Cancel
            </AlertDialogCancel>
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
            <DialogDescription>
              Complete information from Stripe
            </DialogDescription>
          </DialogHeader>
          
          {loadingDetails ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : stripePaymentMethodDetails ? (
            <div className="space-y-4">
              {stripePaymentMethodDetails.stripeUrl && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(stripePaymentMethodDetails.stripeUrl, '_blank')}
                    data-testid="button-view-in-stripe"
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    View in Stripe Dashboard
                  </Button>
                </div>
              )}
              
              <div className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold mb-2">Basic Information</h4>
                  <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ID:</span>
                      <span className="font-mono">{stripePaymentMethodDetails.paymentMethod.id}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type:</span>
                      <span className="capitalize">{stripePaymentMethodDetails.paymentMethod.type}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Created:</span>
                      <span>{new Date(stripePaymentMethodDetails.paymentMethod.created * 1000).toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Live Mode:</span>
                      <span>{stripePaymentMethodDetails.paymentMethod.livemode ? 'Yes' : 'No (Test Mode)'}</span>
                    </div>
                  </div>
                </div>

                {stripePaymentMethodDetails.paymentMethod.card && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Card Details</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Brand:</span>
                        <span className="capitalize">{stripePaymentMethodDetails.paymentMethod.card.brand}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last 4 Digits:</span>
                        <span>{stripePaymentMethodDetails.paymentMethod.card.last4}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Expiration:</span>
                        <span>{stripePaymentMethodDetails.paymentMethod.card.exp_month}/{stripePaymentMethodDetails.paymentMethod.card.exp_year}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Funding:</span>
                        <span className="capitalize">{stripePaymentMethodDetails.paymentMethod.card.funding}</span>
                      </div>
                      {stripePaymentMethodDetails.paymentMethod.card.country && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Country:</span>
                          <span>{stripePaymentMethodDetails.paymentMethod.card.country}</span>
                        </div>
                      )}
                      {stripePaymentMethodDetails.paymentMethod.card.fingerprint && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Fingerprint:</span>
                          <span className="font-mono text-xs">{stripePaymentMethodDetails.paymentMethod.card.fingerprint}</span>
                        </div>
                      )}
                      {stripePaymentMethodDetails.paymentMethod.card.checks && (
                        <div>
                          <span className="text-muted-foreground block mb-1">Checks:</span>
                          <div className="pl-4 space-y-1">
                            {stripePaymentMethodDetails.paymentMethod.card.checks.cvc_check && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground text-xs">CVC:</span>
                                <span className="text-xs">{stripePaymentMethodDetails.paymentMethod.card.checks.cvc_check}</span>
                              </div>
                            )}
                            {stripePaymentMethodDetails.paymentMethod.card.checks.address_line1_check && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground text-xs">Address Line 1:</span>
                                <span className="text-xs">{stripePaymentMethodDetails.paymentMethod.card.checks.address_line1_check}</span>
                              </div>
                            )}
                            {stripePaymentMethodDetails.paymentMethod.card.checks.address_postal_code_check && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground text-xs">Postal Code:</span>
                                <span className="text-xs">{stripePaymentMethodDetails.paymentMethod.card.checks.address_postal_code_check}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {stripePaymentMethodDetails.paymentMethod.us_bank_account && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Bank Account Details</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      {stripePaymentMethodDetails.paymentMethod.us_bank_account.bank_name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Bank:</span>
                          <span>{stripePaymentMethodDetails.paymentMethod.us_bank_account.bank_name}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Last 4 Digits:</span>
                        <span>{stripePaymentMethodDetails.paymentMethod.us_bank_account.last4}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account Type:</span>
                        <span className="capitalize">{stripePaymentMethodDetails.paymentMethod.us_bank_account.account_type}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Account Holder:</span>
                        <span className="capitalize">{stripePaymentMethodDetails.paymentMethod.us_bank_account.account_holder_type}</span>
                      </div>
                      {stripePaymentMethodDetails.paymentMethod.us_bank_account.routing_number && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Routing Number:</span>
                          <span>{stripePaymentMethodDetails.paymentMethod.us_bank_account.routing_number}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {stripePaymentMethodDetails.paymentMethod.billing_details && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Billing Details</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      {stripePaymentMethodDetails.paymentMethod.billing_details.name && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Name:</span>
                          <span>{stripePaymentMethodDetails.paymentMethod.billing_details.name}</span>
                        </div>
                      )}
                      {stripePaymentMethodDetails.paymentMethod.billing_details.email && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Email:</span>
                          <span>{stripePaymentMethodDetails.paymentMethod.billing_details.email}</span>
                        </div>
                      )}
                      {stripePaymentMethodDetails.paymentMethod.billing_details.phone && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Phone:</span>
                          <span>{stripePaymentMethodDetails.paymentMethod.billing_details.phone}</span>
                        </div>
                      )}
                      {stripePaymentMethodDetails.paymentMethod.billing_details.address && (
                        <div>
                          <span className="text-muted-foreground block mb-1">Address:</span>
                          <div className="pl-4 text-sm">
                            {stripePaymentMethodDetails.paymentMethod.billing_details.address.line1 && (
                              <div>{stripePaymentMethodDetails.paymentMethod.billing_details.address.line1}</div>
                            )}
                            {stripePaymentMethodDetails.paymentMethod.billing_details.address.line2 && (
                              <div>{stripePaymentMethodDetails.paymentMethod.billing_details.address.line2}</div>
                            )}
                            {(stripePaymentMethodDetails.paymentMethod.billing_details.address.city || 
                              stripePaymentMethodDetails.paymentMethod.billing_details.address.state || 
                              stripePaymentMethodDetails.paymentMethod.billing_details.address.postal_code) && (
                              <div>
                                {stripePaymentMethodDetails.paymentMethod.billing_details.address.city}
                                {stripePaymentMethodDetails.paymentMethod.billing_details.address.city && stripePaymentMethodDetails.paymentMethod.billing_details.address.state && ', '}
                                {stripePaymentMethodDetails.paymentMethod.billing_details.address.state} {stripePaymentMethodDetails.paymentMethod.billing_details.address.postal_code}
                              </div>
                            )}
                            {stripePaymentMethodDetails.paymentMethod.billing_details.address.country && (
                              <div>{stripePaymentMethodDetails.paymentMethod.billing_details.address.country}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {stripePaymentMethodDetails.paymentMethod.metadata && Object.keys(stripePaymentMethodDetails.paymentMethod.metadata).length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">Metadata</h4>
                    <div className="bg-muted/50 rounded-lg p-3 space-y-2 text-sm">
                      {Object.entries(stripePaymentMethodDetails.paymentMethod.metadata).map(([key, value]) => (
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

      <Dialog open={addDialogOpen} onOpenChange={handleCancelAddPaymentMethod}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Payment Method</DialogTitle>
            <DialogDescription>
              {confirmedPaymentMethodId 
                ? "Saving payment method..." 
                : "Enter your card details to add a new payment method."
              }
            </DialogDescription>
          </DialogHeader>
          {isLoadingSetupIntent || !clientSecret ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : confirmedPaymentMethodId ? (
            <div className="space-y-4 py-4">
              {addPaymentMethodMutation.isPending ? (
                <div className="flex flex-col items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-4" />
                  <p className="text-sm text-muted-foreground">Saving payment method...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8">
                  <Alert variant="destructive" className="mb-4">
                    <AlertDescription>
                      Failed to save payment method. You can retry or cancel.
                    </AlertDescription>
                  </Alert>
                  <div className="flex space-x-2">
                    <Button
                      variant="outline"
                      onClick={handleCancelAddPaymentMethod}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={handleRetryAttachment}
                      data-testid="button-retry-payment-method"
                    >
                      Retry
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <PaymentMethodCollector
              clientSecret={clientSecret}
              onSuccess={handlePaymentMethodSuccess}
              onCancel={handleCancelAddPaymentMethod}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function StripePaymentMethodsPage() {
  return (
    <EmployerLayout activeTab="payment-methods">
      <PaymentMethodsContent />
    </EmployerLayout>
  );
}
