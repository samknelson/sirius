import { Route, Switch } from "wouter";
import BaoCobraCases from "@/pages/sitespecific/bao/cobra-cases";
import BaoCobraCaseView from "@/pages/sitespecific/bao/cobra-case-view";
import BaoCases from "@/pages/sitespecific/bao/cases";
import BaoCaseDetail from "@/pages/sitespecific/bao/case-detail";
import CaseListPanel from "@/components/sitespecific/bao/CaseListPanel";
import AccountParticipants from "@/pages/account-participants";
import AccountTransactions from "@/pages/config/ledger/account-transactions";
import { LedgerTransactionsView } from "@/components/ledger/LedgerTransactionsView";
import { PageTitleProvider } from "@/contexts/PageTitleContext";
import { MaskModeControl } from "@/privacy/MaskMode";
import { AuthProvider } from "@/contexts/AuthContext";

/** Real affected pages, with fictional HTTP data and only tab-access chrome stubbed. */
export function CaseLedgerFixture() {
  return <AuthProvider><PageTitleProvider>
    <MaskModeControl />
    <Switch>
      <Route path="/cobra/cases" component={BaoCobraCases} />
      <Route path="/cobra/cases/:id" component={BaoCobraCaseView} />
      <Route path="/bao/cases" component={BaoCases} />
      <Route path="/bao/cases/:id" component={BaoCaseDetail} />
      <Route path="/shared-cases"><CaseListPanel /></Route>
      <Route path="/ledger/accounts/:id/participants" component={AccountParticipants} />
      <Route path="/ledger/accounts/:id/transactions" component={AccountTransactions} />
      <Route path="/shared-transactions">
        <LedgerTransactionsView baseUrl="/api/ledger/accounts/account-fixture/transactions" title="Shared Transactions" csvFilename="shared" />
      </Route>
    </Switch>
  </PageTitleProvider></AuthProvider>;
}
