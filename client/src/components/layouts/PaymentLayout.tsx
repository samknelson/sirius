import { createContext, useContext, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import type { LedgerPayment, LedgerPaymentType } from "@shared/schema";
import { ArrowLeft, CreditCard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getPaymentTitle } from "@/lib/payment-utils";
import { useLedgerPaymentTabAccess } from "@/hooks/useTabAccess";

interface PaymentLayoutContextValue {
  payment: LedgerPayment;
  paymentType: LedgerPaymentType | undefined;
  isLoading: boolean;
  isError: boolean;
}

const PaymentLayoutContext = createContext<PaymentLayoutContextValue | null>(null);

export function usePaymentLayout() {
  const context = useContext(PaymentLayoutContext);
  if (!context) {
    throw new Error("usePaymentLayout must be used within PaymentLayout");
  }
  return context;
}

interface PaymentLayoutProps {
  children: ReactNode;
  activeTab: "view" | "edit";
}

export function PaymentLayout({ children, activeTab }: PaymentLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: payment, isLoading: isLoadingPayment, error: paymentError } = useQuery<LedgerPayment>({
    queryKey: ["/api/ledger/payments", id],
  });

  const { data: paymentTypes = [], isLoading: isLoadingTypes } = useQuery<LedgerPaymentType[]>({
    queryKey: ["/api/ledger/payment-types"],
  });

  // Hook must be called before any conditional returns (React rules of hooks)
  const { tabs: mainTabs } = useLedgerPaymentTabAccess(id || "");

  const isLoading = isLoadingPayment || isLoadingTypes;
  const isError = !!paymentError;

  if (paymentError) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <CreditCard className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Payment Not Found</span>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <CreditCard className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Payment Not Found</h3>
              <p className="text-muted-foreground text-center">
                The payment you're looking for doesn't exist or has been removed.
              </p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (isLoading || !payment) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <CreditCard className="text-primary-foreground" size={16} />
                </div>
                <Skeleton className="h-6 w-48" />
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <Skeleton className="h-16 w-16 rounded-full mb-4" />
              <Skeleton className="h-6 w-48 mb-2" />
              <Skeleton className="h-4 w-64" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const paymentType = paymentTypes.find(pt => pt.id === payment.paymentType);
  const paymentTitle = getPaymentTitle(payment, paymentType);

  const contextValue: PaymentLayoutContextValue = {
    payment,
    paymentType,
    isLoading: false,
    isError: false,
  };

  return (
    <PaymentLayoutContext.Provider value={contextValue}>
      <div className="bg-background text-foreground min-h-screen">
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <CreditCard className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground" data-testid="text-payment-title">
                  {paymentTitle}
                </h1>
              </div>
              {payment.ledgerEaId && (
                <Link href={`/ea/${payment.ledgerEaId}/payments`}>
                  <Button variant="ghost" size="sm" data-testid="link-ea-payments">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to payments
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </header>

        <div className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center space-x-2 py-3">
              {mainTabs.map((tab) => {
                const isActive = tab.id === activeTab;
                return isActive ? (
                  <Button
                    key={tab.id}
                    variant="default"
                    size="sm"
                    data-testid={`button-payment-${tab.id}`}
                  >
                    {tab.label}
                  </Button>
                ) : (
                  <Link key={tab.id} href={tab.href}>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid={`button-payment-${tab.id}`}
                    >
                      {tab.label}
                    </Button>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>
      </div>
    </PaymentLayoutContext.Provider>
  );
}
