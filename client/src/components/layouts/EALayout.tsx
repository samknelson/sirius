import { ReactNode } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileText } from "lucide-react";
import { Loader2 } from "lucide-react";

interface EALayoutProps {
  activeTab: "view" | "invoices" | "payments";
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
};

export function EALayout({ activeTab, children }: EALayoutProps) {
  const { id } = useParams<{ id: string }>();

  const { data: ea, isLoading: eaLoading } = useQuery<LedgerEA>({
    queryKey: ['/api/ledger/ea', id],
  });

  const { data: account } = useQuery<LedgerAccount>({
    queryKey: ['/api/ledger/accounts', ea?.accountId],
    enabled: !!ea?.accountId,
  });

  const { data: employer } = useQuery<{ id: string; name: string }>({
    queryKey: ['/api/employers', ea?.entityId],
    enabled: !!ea?.entityId && ea?.entityType === 'employer',
  });

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

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground mb-6" data-testid="breadcrumb">
        <Link href="/employers" className="hover:text-foreground transition-colors">
          Employers
        </Link>
        {employer && (
          <>
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
        <ChevronRight size={16} />
        <span className="text-foreground font-medium">
          {account?.name || "Account Entry"}
        </span>
      </nav>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-lg bg-primary/10">
          <FileText className="h-6 w-6 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold text-foreground mb-1" data-testid="heading-ea">
            {account?.name || "Account Entry"}
          </h1>
          {account?.description && (
            <p className="text-muted-foreground" data-testid="text-account-description">
              {account.description}
            </p>
          )}
        </div>
      </div>

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
          <Link
            href={`/ea/${id}/payments`}
            className={`pb-3 border-b-2 transition-colors ${
              activeTab === "payments"
                ? "border-primary text-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            data-testid="tab-payments"
          >
            Payments
          </Link>
        </nav>
      </div>

      {children}
    </div>
  );
}
