import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Package } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { useLedgerPaymentBatchTabAccess } from "@/hooks/useTabAccess";
import type { LedgerPaymentBatch } from "@shared/schema/ledger/payment-batch/schema";

interface PaymentBatchLayoutProps {
  activeTab: string;
  children: ReactNode;
}

interface PaymentBatchLayoutContextValue {
  batch: LedgerPaymentBatch;
}

const PaymentBatchLayoutContext = createContext<PaymentBatchLayoutContextValue | null>(null);

export function usePaymentBatchLayout() {
  const context = useContext(PaymentBatchLayoutContext);
  if (!context) {
    throw new Error("usePaymentBatchLayout must be used within PaymentBatchLayout");
  }
  return context;
}

export function PaymentBatchLayout({ activeTab, children }: PaymentBatchLayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: batch, isLoading, error } = useQuery<LedgerPaymentBatch>({
    queryKey: ["/api/ledger-payment-batches", id],
    enabled: !!id,
  });

  const { tabs: mainTabs } = useLedgerPaymentBatchTabAccess(id);

  usePageTitle(batch?.name || "Payment Batch");

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" data-testid="loader-batch" />
        </div>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="text-center py-12">
          <p className="text-destructive mb-4" data-testid="text-batch-error">Payment batch not found or failed to load.</p>
          <Link href={`/ledger/accounts`}>
            <Button variant="outline" data-testid="button-back-to-accounts">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Accounts
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
          <Link href={`/ledger/accounts/${batch.accountId}`} className="hover:text-foreground transition-colors">
            Account
          </Link>
          <ChevronRight size={16} />
          <Link href={`/ledger/accounts/${batch.accountId}/batches`} className="hover:text-foreground transition-colors">
            Batches
          </Link>
          <ChevronRight size={16} />
          <span className="text-foreground font-medium">
            {batch.name}
          </span>
        </nav>
        <Link href={`/ledger/accounts/${batch.accountId}/batches`}>
          <Button variant="ghost" size="sm" data-testid="button-back-to-batches">
            <ArrowLeft size={16} className="mr-2" />
            Back to Batches
          </Button>
        </Link>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <Package className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-foreground" data-testid="heading-batch-name">
            {batch.name}
          </h1>
        </div>
      </div>

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6" data-testid="nav-tabs">
          {mainTabs.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`pb-3 border-b-2 transition-colors flex items-center gap-2 ${
                  isActive
                    ? "border-primary text-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <PaymentBatchLayoutContext.Provider value={{ batch }}>
        {children}
      </PaymentBatchLayoutContext.Provider>
    </div>
  );
}
