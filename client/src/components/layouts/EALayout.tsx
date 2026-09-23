import { ReactNode, createContext, useContext } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText } from "lucide-react";
import { Loader2 } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { RecordTitleBar } from "@/components/shared/RecordTitleBar";
import { apiRequest, getApiErrorMessage } from "@/lib/queryClient";
import { EmployerPayAction, type EmployerCheckout } from "@/components/ledger/EmployerPayAction";

interface EALayoutProps {
  activeTab: string;
  children: ReactNode;
}

type LedgerEA = {
  id: string;
  accountId: string;
  entityType: string;
  entityId: string;
  data: unknown;
};

type LedgerAccount = {
  id: string;
  name: string;
  description: string | null;
  currencyCode: string;
  data: {
    invoicesEnabled?: boolean;
    invoiceHeader?: string;
    invoiceFooter?: string;
  } | null;
};

interface EALayoutContextValue {
  ea: LedgerEA | undefined;
  account: LedgerAccount | undefined;
  currencyCode: string;
  employerCheckout: EmployerCheckout | undefined;
}

const EALayoutContext = createContext<EALayoutContextValue | null>(null);

export function useEALayout() {
  const context = useContext(EALayoutContext);
  if (!context) {
    throw new Error("useEALayout must be used within EALayout");
  }
  return context;
}

export function EALayout({ activeTab, children }: EALayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: ea, isLoading: eaLoading } = useQuery<LedgerEA>({
    queryKey: ['/api/ledger/ea', id],
  });

  const { data: account } = useQuery<LedgerAccount>({
    queryKey: [`/api/ledger/accounts/${ea?.accountId}`],
    staleTime: 0, // Ensure fresh data for currency code
    enabled: !!ea?.accountId,
  });

  const { data: employer } = useQuery<{ id: string; name: string }>({
    queryKey: ['/api/employers', ea?.entityId],
    enabled: !!ea?.entityId && ea?.entityType === 'employer',
  });

  const { data: worker } = useQuery<{ id: string; firstName: string; lastName: string }>({
    queryKey: ['/api/workers', ea?.entityId],
    enabled: !!ea?.entityId && ea?.entityType === 'worker',
  });
  const checkout = useQuery<EmployerCheckout>({
    queryKey: ["employer-checkout-entry", ea?.entityId, id],
    queryFn: () => apiRequest("GET", `/api/ledger/checkout/employer/${encodeURIComponent(ea!.entityId)}/${encodeURIComponent(id)}`),
    enabled: ea?.entityType === "employer",
    retry: false,
    refetchOnMount: "always",
  });

  // Set page title based on account name
  usePageTitle(account?.name);

  if (eaLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!ea) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Account entry not found</p>
      </div>
    );
  }

  const entityName = employer?.name || (worker ? `${worker.firstName} ${worker.lastName}` : null);
  const entityBackLink = employer 
    ? `/employers/${employer.id}/ledger/accounts`
    : worker 
      ? `/workers/${worker.id}`
      : null;
  const entityBackLabel = employer ? "Back to Employer" : worker ? "Back to Worker" : null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <RecordTitleBar
        variant="page"
        icon={<FileText className="h-6 w-6 text-primary" />}
        title={entityName && account ? `${entityName} - ${account.name}` : account?.name || "Account Entry"}
        titleTestId="heading-ea"
        subtitle={
          account?.description && (
            <p className="text-muted-foreground mt-1" data-testid="text-account-description">
              {account.description}
            </p>
          )
        }
        breadcrumb={
          <nav className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="breadcrumb">
            {employer && (
              <>
                <Link href="/employers" className="hover:text-foreground transition-colors">
                  Employers
                </Link>
                <ChevronRight size={16} />
                <Link href={`/employers/${employer.id}`} className="hover:text-foreground transition-colors">
                  {employer.name}
                </Link>
                <ChevronRight size={16} />
                <Link href={`/employers/${employer.id}/ledger/accounts`} className="hover:text-foreground transition-colors">
                  Accounts
                </Link>
              </>
            )}
            {worker && (
              <>
                <Link href="/workers" className="hover:text-foreground transition-colors">
                  Workers
                </Link>
                <ChevronRight size={16} />
                <Link href={`/workers/${worker.id}`} className="hover:text-foreground transition-colors">
                  {worker.firstName} {worker.lastName}
                </Link>
              </>
            )}
            <ChevronRight size={16} />
            <span className="text-foreground font-medium">
              {account?.name || "Account Entry"}
            </span>
          </nav>
        }
        backLink={
          entityBackLink && entityBackLabel
            ? { href: entityBackLink, label: entityBackLabel, testId: "link-back-to-entity" }
            : undefined
        }
        recordId={ea.id}
      />

      <div className="border-b border-border mb-6">
        <nav className="flex gap-6" data-testid="nav-tabs">
          <Link
            href={`/ea/${id}`}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "view"
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-view"
          >
            View
          </Link>
          {account?.data?.invoicesEnabled !== false && (
            <Link
              href={`/ea/${id}/invoices`}
              className={`pb-3 border-b-2 transition-colors ${
                activeTab === "invoices"
                  ? "border-primary text-primary font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
              data-testid="tab-invoices"
            >
              Invoices
            </Link>
          )}
          <Link
            href={`/ea/${id}/payments`}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "payments"
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-payments"
          >
            Payments and Adjustments
          </Link>
          <Link
            href={`/ea/${id}/transactions`}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "transactions"
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-transactions"
          >
            Transactions
          </Link>
          <Link
            href={`/ea/${id}/summary`}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "summary"
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-summary"
          >
            Account Summary
          </Link>
        </nav>
      </div>

      {ea.entityType === "employer" && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <EmployerPayAction eaId={ea.id} checkout={checkout.data} />
          {checkout.isError && <p className="text-sm text-muted-foreground" data-testid="employer-payment-guidance">
            {(checkout.error as { status?: number })?.status === 403
              ? "Billing contact status alone does not grant payment access. Ask an administrator to enable online payments for your contact at this employer."
              : getApiErrorMessage(checkout.error, "Online payment is unavailable for this account.")}
          </p>}
          {checkout.data && Number(checkout.data.available) <= 0 && <p className="text-sm text-muted-foreground">No amount is currently available to pay online.</p>}
        </div>
      )}
      <EALayoutContext.Provider value={{ ea, account, currencyCode: account?.currencyCode || "USD", employerCheckout: checkout.data }}>
        {children}
      </EALayoutContext.Provider>
    </div>
  );
}
