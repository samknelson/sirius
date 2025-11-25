import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useEffect } from "react";
import LoginPage from "@/pages/login";
import UnauthorizedPage from "@/pages/unauthorized";
import Bootstrap from "@/pages/bootstrap";
import Dashboard from "@/pages/dashboard";
import Bookmarks from "@/pages/bookmarks";
import Reports from "@/pages/reports";
import ReportType from "@/pages/report-type";
import Workers from "@/pages/workers";
import WorkersAdd from "@/pages/workers-add";
import WorkerView from "@/pages/worker-view";
import WorkerName from "@/pages/worker-name";
import WorkerEmail from "@/pages/worker-email";
import WorkerIDs from "@/pages/worker-ids";
import WorkerBirthDate from "@/pages/worker-birth-date";
import WorkerGender from "@/pages/worker-gender";
import WorkerWorkStatus from "@/pages/worker-work-status";
import WorkerBenefits from "@/pages/worker-benefits";
import WorkerCurrentEmployment from "@/pages/worker-current-employment";
import WorkerEmploymentHistory from "@/pages/worker-employment-history";
import WorkerHoursMonthly from "@/pages/worker-hours-monthly";
import WorkerHoursDaily from "@/pages/worker-hours-daily";
import WorkerLogs from "@/pages/worker-logs";
import WorkerAddresses from "@/pages/worker-addresses";
import WorkerPhoneNumbers from "@/pages/worker-phone-numbers";
import WorkerDelete from "@/pages/worker-delete";
import Employers from "@/pages/employers";
import EmployersAdd from "@/pages/employers-add";
import EmployerView from "@/pages/employer-view";
import EmployerEdit from "@/pages/employer-edit";
import EmployerWorkers from "@/pages/employer-workers";
import EmployerContacts from "@/pages/employer-contacts";
import EmployerWizards from "@/pages/employer-wizards";
import EmployersMonthlyUploads from "@/pages/employers-monthly-uploads";
import AllEmployerContacts from "@/pages/all-employer-contacts";
import EmployerContactView from "@/pages/employer-contact-view";
import EmployerContactEdit from "@/pages/employer-contact-edit";
import EmployerContactName from "@/pages/employer-contact-name";
import EmployerContactEmail from "@/pages/employer-contact-email";
import EmployerContactPhoneNumbers from "@/pages/employer-contact-phone-numbers";
import EmployerContactAddresses from "@/pages/employer-contact-addresses";
import EmployerContactUser from "@/pages/employer-contact-user";
import EmployerLogs from "@/pages/employer-logs";
import WizardView from "@/pages/wizard-view";
import StripeCustomerPage from "@/pages/employers/stripe-customer";
import StripePaymentMethodsPage from "@/pages/employers/stripe-payment-methods";
import EmployerLedgerAccountsWrapper from "@/pages/employer-ledger-accounts-wrapper";
import EAView from "@/pages/ea-view";
import EAInvoices from "@/pages/ea-invoices";
import EAPayments from "@/pages/ea-payments";
import EATransactions from "@/pages/ea-transactions";
import PaymentView from "@/pages/payment-view";
import PaymentEdit from "@/pages/payment-edit";
import TrustBenefits from "@/pages/trust-benefits";
import TrustBenefitsAdd from "@/pages/trust-benefits-add";
import TrustBenefitView from "@/pages/trust-benefit-view";
import TrustBenefitEdit from "@/pages/trust-benefit-edit";
import TrustProvidersPage from "@/pages/trust-providers";
import TrustProviderViewPage from "@/pages/trust-provider-view";
import TrustProviderEditPage from "@/pages/trust-provider-edit";
import TrustProviderContactsPage from "@/pages/trust-provider-contacts";
import TrustProviderContactView from "@/pages/trust-provider-contact-view";
import TrustProviderContactEdit from "@/pages/trust-provider-contact-edit";
import TrustProviderContactName from "@/pages/trust-provider-contact-name";
import TrustProviderContactEmail from "@/pages/trust-provider-contact-email";
import TrustProviderContactPhoneNumbers from "@/pages/trust-provider-contact-phone-numbers";
import TrustProviderContactAddresses from "@/pages/trust-provider-contact-addresses";
import TrustProviderContactUser from "@/pages/trust-provider-contact-user";
import TrustProviderLogsPage from "@/pages/trust-provider-logs";
import AdminUsersPage from "@/pages/admin/users";
import UserAccountPage from "@/pages/admin/user-account";
import UserLogs from "@/pages/admin/user-logs";
import AdminRolesPage from "@/pages/admin/roles";
import AdminPermissionsPage from "@/pages/admin/permissions";
import AdminQuickstarts from "@/pages/admin-quickstarts";
import CronJobs from "@/pages/cron-jobs";
import CronJobView from "@/pages/cron-job-view";
import CronJobSettings from "@/pages/cron-job-settings";
import CronJobHistory from "@/pages/cron-job-history";
import AdminLayout from "@/components/layouts/AdminLayout";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import UsersListPage from "@/pages/config/users/list";
import RolesPage from "@/pages/config/users/roles";
import PermissionsPage from "@/pages/config/users/permissions";
import PoliciesPage from "@/pages/config/users/policies";
import EmployerUserSettingsPage from "@/pages/config/users/employer-settings";
import TrustProviderUserSettingsPage from "@/pages/config/users/trust-provider-settings";
import PostalAddressesConfigPage from "@/pages/config/addresses";
import PhoneNumbersConfigPage from "@/pages/config/phone-numbers";
import GenderOptionsPage from "@/pages/config/gender-options";
import WorkerIDTypesPage from "@/pages/config/worker-id-types";
import WorkerWorkStatusesPage from "@/pages/config/worker-work-statuses";
import EmploymentStatusesPage from "@/pages/config/employment-statuses";
import TrustBenefitTypesPage from "@/pages/config/trust-benefit-types";
import EmployerContactTypesPage from "@/pages/config/employer-contact-types";
import ProviderContactTypesPage from "@/pages/config/provider-contact-types";
import MasqueradePage from "@/pages/config/masquerade";
import LogsPage from "@/pages/config/logs";
import DashboardPluginsConfigPage from "@/pages/config/dashboard-plugins";
import PluginSettingsPage from "@/pages/config/plugin-settings";
import ComponentsConfigPage from "@/pages/config/components";
import StripeTestPage from "@/pages/config/ledger/stripe/test";
import StripeSettingsPage from "@/pages/config/ledger/stripe/settings";
import PaymentTypesPage from "@/pages/config/ledger/stripe/payment-types";
import LedgerPaymentTypesPage from "@/pages/config/ledger-payment-types";
import ChargePluginsListPage from "@/pages/config/ledger/charge-plugins-list";
import ChargePluginConfigPage from "@/pages/config/ledger/charge-plugin-config";

// Import charge plugin UIs to register them
import "@/plugins/charge-plugins";
import LedgerAccountsPage from "@/pages/config/ledger/accounts";
import LedgerAccountView from "@/pages/config/ledger/account-view";
import LedgerAccountEdit from "@/pages/config/ledger/account-edit";
import AccountPayments from "@/pages/config/ledger/account-payments";
import AccountTransactions from "@/pages/config/ledger/account-transactions";
import AccountParticipants from "@/pages/account-participants";
import AccountSettings from "@/pages/config/ledger/account-settings";
import EaTransactions from "@/pages/config/ledger/ea-transactions";
import SiteInformation from "@/pages/site-information";
import NotFound from "@/pages/not-found";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  // Check if bootstrap is needed
  const { data: bootstrapData, isLoading: isBootstrapLoading } = useQuery<{
    needed: boolean;
  }>({
    queryKey: ["/api/bootstrap/needed"],
    retry: false,
  });

  // Redirect to bootstrap page if needed
  useEffect(() => {
    if (!isBootstrapLoading && bootstrapData) {
      if (bootstrapData.needed && location !== "/bootstrap") {
        setLocation("/bootstrap");
      } else if (!bootstrapData.needed && location === "/bootstrap") {
        setLocation("/login");
      }
    }
  }, [bootstrapData, isBootstrapLoading, location, setLocation]);

  // Show loading while checking bootstrap status
  if (isBootstrapLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900 dark:border-gray-100 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Public routes */}
      <Route path="/bootstrap" component={Bootstrap} />
      <Route path="/login" component={LoginPage} />
      <Route path="/unauthorized" component={UnauthorizedPage} />

      {/* Protected routes */}
      <Route path="/workers/add">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <WorkersAdd />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/phone-numbers">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerPhoneNumbers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/addresses">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerAddresses />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/name">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerName />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/email">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/ids">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerIDs />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/birth-date">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerBirthDate />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/gender">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerGender />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/work-status">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerWorkStatus />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/benefits">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerBenefits />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/employment/current">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerCurrentEmployment />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/employment/history">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerEmploymentHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/employment/monthly">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerHoursMonthly />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/employment/daily">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerHoursDaily />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/logs">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <WorkerLogs />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/delete">
        <ProtectedRoute policy="worker">
          <AuthenticatedLayout>
            <WorkerDelete />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id">
        <ProtectedRoute policy="worker">
          <AuthenticatedLayout>
            <WorkerView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <Workers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/bookmarks">
        <ProtectedRoute policy="bookmark">
          <AuthenticatedLayout>
            <Bookmarks />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/workers">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="Workers" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/employers">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="Employers" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/:reportType">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ReportType />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <Reports />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/monthly-uploads">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <EmployersMonthlyUploads />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/add">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployersAdd />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/edit">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployerEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/workers">
        <ProtectedRoute policy="employerUser">
          <AuthenticatedLayout>
            <EmployerWorkers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/contacts">
        <ProtectedRoute policy="employersView">
          <AuthenticatedLayout>
            <EmployerContacts />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/wizards">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <EmployerWizards />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/wizards/:id">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <WizardView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <EAView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id/invoices">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <EAInvoices />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id/payments">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <EAPayments />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id/transactions">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <EATransactions />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/payment/:id">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <PaymentView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/payment/:id/edit">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <PaymentEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/all">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <AllEmployerContacts />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerContactView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/edit">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployerContactEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/name">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployerContactName />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/email">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployerContactEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/phone-numbers">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployerContactPhoneNumbers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/addresses">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <EmployerContactAddresses />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/user">
        <ProtectedRoute policy="employerUserManage">
          <AuthenticatedLayout>
            <EmployerContactUser />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/ledger/stripe/customer">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <StripeCustomerPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/ledger/stripe/payment_methods">
        <ProtectedRoute policy="ledgerStripeEmployer">
          <AuthenticatedLayout>
            <StripePaymentMethodsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/ledger/accounts">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <EmployerLedgerAccountsWrapper />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/logs">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <EmployerLogs />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id">
        <ProtectedRoute policy="employerUser">
          <AuthenticatedLayout>
            <EmployerView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers">
        <ProtectedRoute policy="employersView">
          <AuthenticatedLayout>
            <Employers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-benefits/add">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <TrustBenefitsAdd />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-benefits/:id/edit">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <TrustBenefitEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-benefits/:id">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <TrustBenefitView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-benefits">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <TrustBenefits />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id/logs">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderLogsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/user">
        <ProtectedRoute policy="trustProviderUserManage">
          <AuthenticatedLayout>
            <TrustProviderContactUser />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/addresses">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactAddresses />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/phone-numbers">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactPhoneNumbers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/email">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/name">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactName />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/edit">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id/contacts">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <TrustProviderContactsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id/edit">
        <ProtectedRoute permission="workers.manage">
          <AuthenticatedLayout>
            <TrustProviderEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <TrustProviderViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/providers">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <TrustProvidersPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Configuration routes with nested navigation */}
      <Route path="/config/users/list">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <UsersListPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/users/roles">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <RolesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/users/permissions">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PermissionsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/users/policies">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PoliciesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/users/employer-settings">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EmployerUserSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/users/trust-provider-settings">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <TrustProviderUserSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Redirect old /config/users to new structure */}
      <Route path="/config/users">
        <Redirect to="/config/users/list" />
      </Route>

      <Route path="/config/addresses">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PostalAddressesConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/phone-numbers">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PhoneNumbersConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/gender-options">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <GenderOptionsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/worker-id-types">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <WorkerIDTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/worker-work-statuses">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <WorkerWorkStatusesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/employment-statuses">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EmploymentStatusesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/trust-benefit-types">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <TrustBenefitTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/employer-contact-types">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EmployerContactTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/provider-contact-types">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ProviderContactTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/site">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <SiteInformation />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dashboard-plugins">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <DashboardPluginsConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dashboard-plugins/:pluginId">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PluginSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/components">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ComponentsConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/masquerade">
        <ProtectedRoute policy="masquerade">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <MasqueradePage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/logs">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <LogsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/stripe/settings">
        <ProtectedRoute policy="ledgerStripeAdmin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <StripeSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/stripe/test">
        <ProtectedRoute policy="ledgerStripeAdmin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <StripeTestPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/stripe/payment-types">
        <ProtectedRoute policy="ledgerStripeAdmin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PaymentTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/payment-types">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <LedgerPaymentTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/charge-plugins">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ChargePluginsListPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/charge-plugins/:pluginId">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ChargePluginConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Ledger account detail pages */}
      <Route path="/ledger/accounts/:id/payments">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <AccountPayments />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/transactions">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <AccountTransactions />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/participants">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <AccountParticipants />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/settings">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <AccountSettings />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/edit">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <LedgerAccountEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <LedgerAccountView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <LedgerAccountsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Ledger EA detail pages */}
      <Route path="/ledger/ea/:id/transactions">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <EaTransactions />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* User detail page */}
      <Route path="/users/:id">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <UserAccountPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/logs">
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <UserLogs />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Legacy admin routes - redirect to configuration */}
      <Route path="/admin/users/:id">
        <Redirect to="/users/:id" />
      </Route>

      <Route path="/admin/users">
        <Redirect to="/config/users/list" />
      </Route>

      <Route path="/config/users/:id">
        <Redirect to="/users/:id" />
      </Route>

      {/* Legacy ledger account routes - redirect to new location */}
      <Route path="/config/ledger/accounts/:id/edit">
        <Redirect to="/ledger/accounts/:id/edit" />
      </Route>

      <Route path="/config/ledger/accounts/:id/payments">
        <Redirect to="/ledger/accounts/:id/payments" />
      </Route>

      <Route path="/config/ledger/accounts/:id">
        <Redirect to="/ledger/accounts/:id" />
      </Route>

      <Route path="/config/ledger/accounts">
        <Redirect to="/ledger/accounts" />
      </Route>

      <Route path="/admin/roles">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminRolesPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/permissions">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminPermissionsPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/quickstarts">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <AdminQuickstarts />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name/view">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <CronJobView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name/settings">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <CronJobSettings />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name/history">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <CronJobHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name">
        {(params) => <Redirect to={`/cron-jobs/${params.name}/view`} />}
      </Route>

      <Route path="/cron-jobs">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <CronJobs />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/cron-jobs">
        <Redirect to="/cron-jobs" />
      </Route>

      {/* Legacy admin route - redirect to configuration */}
      <Route path="/admin">
        <Redirect to="/config/users/list" />
      </Route>

      {/* Dashboard route */}
      <Route path="/dashboard">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <Dashboard />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Root route - redirect to dashboard */}
      <Route path="/">
        <Redirect to="/dashboard" />
      </Route>

      {/* Configuration fallback - redirect to users page */}
      <Route path="/config">
        <Redirect to="/config/users/list" />
      </Route>

      {/* 404 for unmatched routes */}
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <Router />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
