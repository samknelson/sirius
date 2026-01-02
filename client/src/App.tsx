import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { TerminologyProvider } from "@/contexts/TerminologyContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import { useEffect, lazy, Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";

// Import charge plugin UIs to register them (side effect import)
import "@/plugins/charge-plugins";

// Essential pages loaded eagerly for fast initial render
import LoginPage from "@/pages/login";
import UnauthorizedPage from "@/pages/unauthorized";
import NotFound from "@/pages/not-found";

// Lazy-loaded pages
const Bootstrap = lazy(() => import("@/pages/bootstrap"));
const SmsOptinPage = lazy(() => import("@/pages/sms-optin"));
const Dashboard = lazy(() => import("@/pages/dashboard"));
const Bookmarks = lazy(() => import("@/pages/bookmarks"));
const AlertsPage = lazy(() => import("@/pages/alerts").then(m => ({ default: m.default })));
const AlertsRedirect = lazy(() => import("@/pages/alerts").then(m => ({ default: m.AlertsRedirect })));
const Reports = lazy(() => import("@/pages/reports"));
const ReportType = lazy(() => import("@/pages/report-type"));
const Workers = lazy(() => import("@/pages/workers"));
const WorkersAdd = lazy(() => import("@/pages/workers-add"));
const WorkerView = lazy(() => import("@/pages/worker-view"));
const WorkerName = lazy(() => import("@/pages/worker-name"));
const WorkerEmail = lazy(() => import("@/pages/worker-email"));
const WorkerIDs = lazy(() => import("@/pages/worker-ids"));
const WorkerBirthDate = lazy(() => import("@/pages/worker-birth-date"));
const WorkerGender = lazy(() => import("@/pages/worker-gender"));
const WorkerWorkStatus = lazy(() => import("@/pages/worker-work-status"));
const WorkerUserPage = lazy(() => import("@/pages/worker-user"));
const WorkerBargainingUnit = lazy(() => import("@/pages/worker-bargaining-unit"));
const WorkerSteward = lazy(() => import("@/pages/worker-steward"));
const WorkerRepresentatives = lazy(() => import("@/pages/worker-representatives"));
const WorkerDispatchStatus = lazy(() => import("@/pages/workers/dispatch-status"));
const WorkerDispatchDoNotCall = lazy(() => import("@/pages/workers/dispatch-do-not-call"));
const WorkerDispatchHoldForEmployer = lazy(() => import("@/pages/workers/dispatch-hold-for-employer"));
const WorkerBans = lazy(() => import("@/pages/workers/bans"));
const WorkerLedgerAccounts = lazy(() => import("@/pages/worker-ledger-accounts"));
const Stewards = lazy(() => import("@/pages/stewards"));
const WorkerBenefitsHistory = lazy(() => import("@/pages/worker-benefits-history"));
const WorkerBenefitsEligibility = lazy(() => import("@/pages/worker-benefits-eligibility"));
const WorkerBenefitsScan = lazy(() => import("@/pages/worker-benefits-scan"));
const WorkerCurrentEmployment = lazy(() => import("@/pages/worker-current-employment"));
const WorkerEmploymentHistory = lazy(() => import("@/pages/worker-employment-history"));
const WorkerHoursMonthly = lazy(() => import("@/pages/worker-hours-monthly"));
const WorkerHoursDaily = lazy(() => import("@/pages/worker-hours-daily"));
const WorkerHoursView = lazy(() => import("@/pages/worker-hours-view"));
const WorkerHoursEdit = lazy(() => import("@/pages/worker-hours-edit"));
const WorkerHoursDelete = lazy(() => import("@/pages/worker-hours-delete"));
const WorkerLogs = lazy(() => import("@/pages/worker-logs"));
const WorkerAddresses = lazy(() => import("@/pages/worker-addresses"));
const WorkerPhoneNumbers = lazy(() => import("@/pages/worker-phone-numbers"));
const WorkerCommHistory = lazy(() => import("@/pages/worker-comm-history"));
const WorkerSendSms = lazy(() => import("@/pages/worker-send-sms"));
const WorkerSendEmail = lazy(() => import("@/pages/worker-send-email"));
const WorkerSendPostal = lazy(() => import("@/pages/worker-send-postal"));
const WorkerSendInApp = lazy(() => import("@/pages/worker-send-inapp"));
const CommDetail = lazy(() => import("@/pages/comm-detail"));
const WorkerDelete = lazy(() => import("@/pages/worker-delete"));
const Employers = lazy(() => import("@/pages/employers"));
const EmployersAdd = lazy(() => import("@/pages/employers-add"));
const EmployerView = lazy(() => import("@/pages/employer-view"));
const EmployerEdit = lazy(() => import("@/pages/employer-edit"));
const EmployerWorkers = lazy(() => import("@/pages/employer-workers"));
const EmployerContacts = lazy(() => import("@/pages/employer-contacts"));
const EmployerWizards = lazy(() => import("@/pages/employer-wizards"));
const EmployersMonthlyUploads = lazy(() => import("@/pages/employers-monthly-uploads"));
const AllEmployerContacts = lazy(() => import("@/pages/all-employer-contacts"));
const EmployerContactView = lazy(() => import("@/pages/employer-contact-view"));
const EmployerContactEdit = lazy(() => import("@/pages/employer-contact-edit"));
const EmployerContactName = lazy(() => import("@/pages/employer-contact-name"));
const EmployerContactEmail = lazy(() => import("@/pages/employer-contact-email"));
const EmployerContactPhoneNumbers = lazy(() => import("@/pages/employer-contact-phone-numbers"));
const EmployerContactAddresses = lazy(() => import("@/pages/employer-contact-addresses"));
const EmployerContactUser = lazy(() => import("@/pages/employer-contact-user"));
const EmployerContactCommHistory = lazy(() => import("@/pages/employer-contact-comm-history"));
const EmployerContactSendSms = lazy(() => import("@/pages/employer-contact-send-sms"));
const EmployerContactSendEmail = lazy(() => import("@/pages/employer-contact-send-email"));
const EmployerContactSendPostal = lazy(() => import("@/pages/employer-contact-send-postal"));
const EmployerContactSendInApp = lazy(() => import("@/pages/employer-contact-send-inapp"));
const EmployerLogs = lazy(() => import("@/pages/employer-logs"));
const EmployerPolicyHistory = lazy(() => import("@/pages/employer-policy-history"));
const EmployerStewards = lazy(() => import("@/pages/employer-stewards"));
const EmployerDispatchPage = lazy(() => import("@/pages/employers/dispatch"));
const WizardView = lazy(() => import("@/pages/wizard-view"));
const StripeCustomerPage = lazy(() => import("@/pages/employers/stripe-customer"));
const StripePaymentMethodsPage = lazy(() => import("@/pages/employers/stripe-payment-methods"));
const EmployerLedgerAccountsWrapper = lazy(() => import("@/pages/employer-ledger-accounts-wrapper"));
const EAView = lazy(() => import("@/pages/ea-view"));
const EAInvoices = lazy(() => import("@/pages/ea-invoices"));
const EAPayments = lazy(() => import("@/pages/ea-payments"));
const EATransactions = lazy(() => import("@/pages/ea-transactions"));
const PaymentView = lazy(() => import("@/pages/payment-view"));
const PaymentEdit = lazy(() => import("@/pages/payment-edit"));
const TrustBenefits = lazy(() => import("@/pages/trust-benefits"));
const TrustBenefitsAdd = lazy(() => import("@/pages/trust-benefits-add"));
const TrustBenefitView = lazy(() => import("@/pages/trust-benefit-view"));
const TrustBenefitEdit = lazy(() => import("@/pages/trust-benefit-edit"));
const TrustProvidersPage = lazy(() => import("@/pages/trust-providers"));
const TrustProviderViewPage = lazy(() => import("@/pages/trust-provider-view"));
const TrustProviderEditPage = lazy(() => import("@/pages/trust-provider-edit"));
const TrustProviderContactsPage = lazy(() => import("@/pages/trust-provider-contacts"));
const TrustProviderContactView = lazy(() => import("@/pages/trust-provider-contact-view"));
const TrustProviderContactEdit = lazy(() => import("@/pages/trust-provider-contact-edit"));
const TrustProviderContactName = lazy(() => import("@/pages/trust-provider-contact-name"));
const TrustProviderContactEmail = lazy(() => import("@/pages/trust-provider-contact-email"));
const TrustProviderContactPhoneNumbers = lazy(() => import("@/pages/trust-provider-contact-phone-numbers"));
const TrustProviderContactAddresses = lazy(() => import("@/pages/trust-provider-contact-addresses"));
const TrustProviderContactUser = lazy(() => import("@/pages/trust-provider-contact-user"));
const TrustProviderContactCommHistory = lazy(() => import("@/pages/trust-provider-contact-comm-history"));
const TrustProviderContactSendSms = lazy(() => import("@/pages/trust-provider-contact-send-sms"));
const TrustProviderContactSendEmail = lazy(() => import("@/pages/trust-provider-contact-send-email"));
const TrustProviderContactSendPostal = lazy(() => import("@/pages/trust-provider-contact-send-postal"));
const TrustProviderContactSendInApp = lazy(() => import("@/pages/trust-provider-contact-send-inapp"));
const TrustProviderLogsPage = lazy(() => import("@/pages/trust-provider-logs"));
const BargainingUnitsPage = lazy(() => import("@/pages/bargaining-units"));
const BargainingUnitViewPage = lazy(() => import("@/pages/bargaining-unit-view"));
const BargainingUnitEditPage = lazy(() => import("@/pages/bargaining-unit-edit"));
const BargainingUnitDeletePage = lazy(() => import("@/pages/bargaining-unit-delete"));
const AdminUsersPage = lazy(() => import("@/pages/admin/users"));
const UserAccountPage = lazy(() => import("@/pages/admin/user-account"));
const UserLogs = lazy(() => import("@/pages/admin/user-logs"));
const UserEmail = lazy(() => import("@/pages/admin/user-email"));
const UserPhoneNumbers = lazy(() => import("@/pages/admin/user-phone-numbers"));
const UserAddresses = lazy(() => import("@/pages/admin/user-addresses"));
const UserCommHistory = lazy(() => import("@/pages/admin/user-comm-history"));
const UserSendSms = lazy(() => import("@/pages/admin/user-send-sms"));
const UserSendEmail = lazy(() => import("@/pages/admin/user-send-email"));
const UserSendPostal = lazy(() => import("@/pages/admin/user-send-postal"));
const UserSendInApp = lazy(() => import("@/pages/admin/user-send-inapp"));
const AdminRolesPage = lazy(() => import("@/pages/admin/roles"));
const AdminPermissionsPage = lazy(() => import("@/pages/admin/permissions"));
const WmbScanQueue = lazy(() => import("@/pages/admin/wmb-scan-queue"));
const WmbScanDetail = lazy(() => import("@/pages/admin/wmb-scan-detail"));
const AdminQuickstarts = lazy(() => import("@/pages/admin-quickstarts"));
const CronJobs = lazy(() => import("@/pages/cron-jobs"));
const CronJobView = lazy(() => import("@/pages/cron-job-view"));
const CronJobSettings = lazy(() => import("@/pages/cron-job-settings"));
const CronJobHistory = lazy(() => import("@/pages/cron-job-history"));
import AdminLayout from "@/components/layouts/AdminLayout";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
const UsersListPage = lazy(() => import("@/pages/config/users/list"));
const RolesPage = lazy(() => import("@/pages/config/users/roles"));
const PermissionsPage = lazy(() => import("@/pages/config/users/permissions"));
const PoliciesPage = lazy(() => import("@/pages/config/users/policies"));
const EmployerUserSettingsPage = lazy(() => import("@/pages/config/users/employer-settings"));
const TrustProviderUserSettingsPage = lazy(() => import("@/pages/config/users/trust-provider-settings"));
const WorkerUserSettingsPage = lazy(() => import("@/pages/config/users/worker-settings"));
const SessionsPage = lazy(() => import("@/pages/sessions"));
const FloodEventsPage = lazy(() => import("@/pages/flood-events"));
const FloodEventsConfigPage = lazy(() => import("@/pages/flood-events-config"));
const PostalAddressesConfigPage = lazy(() => import("@/pages/config/addresses"));
const PhoneNumbersConfigPage = lazy(() => import("@/pages/config/phone-numbers"));
const GenderOptionsPage = lazy(() => import("@/pages/config/gender-options"));
const WorkerIDTypesPage = lazy(() => import("@/pages/config/worker-id-types"));
const WorkerWorkStatusesPage = lazy(() => import("@/pages/config/worker-work-statuses"));
const StewardSettingsPage = lazy(() => import("@/pages/config/steward-settings"));
const EmploymentStatusesPage = lazy(() => import("@/pages/config/employment-statuses"));
const TrustBenefitTypesPage = lazy(() => import("@/pages/config/trust-benefit-types"));
const EmployerContactTypesPage = lazy(() => import("@/pages/config/employer-contact-types"));
const EmployerTypesPage = lazy(() => import("@/pages/config/employer-types"));
const ProviderContactTypesPage = lazy(() => import("@/pages/config/provider-contact-types"));
const EventTypesPage = lazy(() => import("@/pages/config/event-types"));
const DispatchJobTypesPage = lazy(() => import("@/pages/config/dispatch-job-types"));
const DispatchJobTypeViewPage = lazy(() => import("@/pages/config/dispatch-job-type-view"));
const DispatchJobTypeEditPage = lazy(() => import("@/pages/config/dispatch-job-type-edit"));
const DispatchJobTypeDeletePage = lazy(() => import("@/pages/config/dispatch-job-type-delete"));
const DispatchJobTypePluginsPage = lazy(() => import("@/pages/config/dispatch-job-type-plugins"));
const DispatchDncConfigPage = lazy(() => import("@/pages/config/dispatch-dnc"));
const WorkerBanConfigPage = lazy(() => import("@/pages/config/workers-ban"));
const DispatchJobsPage = lazy(() => import("@/pages/dispatch/jobs"));
const DispatchJobDetailsPage = lazy(() => import("@/pages/dispatch/job-details"));
const DispatchJobEditPage = lazy(() => import("@/pages/dispatch/job-edit"));
const DispatchJobDispatchesPage = lazy(() => import("@/pages/dispatch/job-dispatches"));
const DispatchJobEligibleWorkersPage = lazy(() => import("@/pages/dispatch/job-eligible-workers"));
const DispatchJobNewPage = lazy(() => import("@/pages/dispatch/job-new"));
const MasqueradePage = lazy(() => import("@/pages/config/masquerade"));
const SystemModePage = lazy(() => import("@/pages/config/system-mode"));
const DefaultPolicyPage = lazy(() => import("@/pages/config/default-policy"));
const TwilioConfigPage = lazy(() => import("@/pages/config/twilio"));
const EmailConfigPage = lazy(() => import("@/pages/config/email"));
const PostalConfigPage = lazy(() => import("@/pages/config/postal"));
const LogsPage = lazy(() => import("@/pages/config/logs"));
const DashboardPluginsConfigPage = lazy(() => import("@/pages/config/dashboard-plugins"));
const PluginSettingsPage = lazy(() => import("@/pages/config/plugin-settings"));
const ComponentsConfigPage = lazy(() => import("@/pages/config/components"));
const StripeTestPage = lazy(() => import("@/pages/config/ledger/stripe/test"));
const StripeSettingsPage = lazy(() => import("@/pages/config/ledger/stripe/settings"));
const PaymentTypesPage = lazy(() => import("@/pages/config/ledger/stripe/payment-types"));
const LedgerPaymentTypesPage = lazy(() => import("@/pages/config/ledger-payment-types"));
const ChargePluginsListPage = lazy(() => import("@/pages/config/ledger/charge-plugins-list"));
const ChargePluginConfigPage = lazy(() => import("@/pages/config/ledger/charge-plugin-config"));
const ChargePluginFormPage = lazy(() => import("@/pages/config/ledger/charge-plugin-form"));
const ConfigurationLandingPage = lazy(() => import("@/pages/config/index"));
const LedgerAccountsPage = lazy(() => import("@/pages/config/ledger/accounts"));
const LedgerAccountView = lazy(() => import("@/pages/config/ledger/account-view"));
const LedgerAccountEdit = lazy(() => import("@/pages/config/ledger/account-edit"));
const AccountPayments = lazy(() => import("@/pages/config/ledger/account-payments"));
const AccountTransactions = lazy(() => import("@/pages/config/ledger/account-transactions"));
const AccountParticipants = lazy(() => import("@/pages/account-participants"));
const AccountSettings = lazy(() => import("@/pages/config/ledger/account-settings"));
const SiteInformation = lazy(() => import("@/pages/site-information"));
const TerminologyConfigPage = lazy(() => import("@/pages/config/terminology"));
const PolicyView = lazy(() => import("@/pages/policy-view"));
const PolicyEdit = lazy(() => import("@/pages/policy-edit"));
const PolicyBenefits = lazy(() => import("@/pages/policy-benefits"));
const PoliciesConfigPage = lazy(() => import("@/pages/config/policies"));
const BargainingUnitsConfigPage = lazy(() => import("@/pages/config/bargaining-units"));
const CardcheckDefinitionsPage = lazy(() => import("@/pages/cardcheck-definitions"));
const CardcheckDefinitionViewPage = lazy(() => import("@/pages/cardcheck-definition-view"));
const CardcheckDefinitionEditPage = lazy(() => import("@/pages/cardcheck-definition-edit"));
const WorkerCardchecks = lazy(() => import("@/pages/worker-cardchecks"));
const CardcheckViewPage = lazy(() => import("@/pages/cardcheck-view"));
const EventsListPage = lazy(() => import("@/pages/events"));
const EventViewPage = lazy(() => import("@/pages/event-view"));
const EventEditPage = lazy(() => import("@/pages/event-edit"));
const EventDeletePage = lazy(() => import("@/pages/event-delete"));
const EventRegisterPage = lazy(() => import("@/pages/event-register"));
const EventRosterPage = lazy(() => import("@/pages/event-roster"));
const EventSelfRegisterPage = lazy(() => import("@/pages/event-self-register"));
const BtuCsgListPage = lazy(() => import("@/pages/sitespecific/btu/csg-list"));
const BtuCsgViewPage = lazy(() => import("@/pages/sitespecific/btu/csg-view"));
const BtuCsgEditPage = lazy(() => import("@/pages/sitespecific/btu/csg-edit"));
const BtuCsgNewPage = lazy(() => import("@/pages/sitespecific/btu/csg-new"));
const BtuEmployerMapListPage = lazy(() => import("@/pages/sitespecific/btu/employer-map-list"));

// Loading fallback component
function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="space-y-4 w-full max-w-md">
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

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

  // Check if bootstrap is needed - only for unauthenticated users
  // If user is authenticated, bootstrap was already completed (can't have users without bootstrap)
  const { data: bootstrapData, isLoading: isBootstrapLoading } = useQuery<{
    needed: boolean;
  }>({
    queryKey: ["/api/bootstrap/needed"],
    retry: false,
    enabled: !isAuthenticated && !isLoading,
  });

  // Redirect to bootstrap page if needed (only for unauthenticated users)
  useEffect(() => {
    // Skip redirect logic for authenticated users - they don't need bootstrap
    if (isAuthenticated) return;
    
    if (!isBootstrapLoading && bootstrapData) {
      if (bootstrapData.needed && location !== "/bootstrap") {
        setLocation("/bootstrap");
      } else if (!bootstrapData.needed && location === "/bootstrap") {
        setLocation("/login");
      }
    }
  }, [bootstrapData, isBootstrapLoading, location, setLocation, isAuthenticated]);

  // Show loading while checking auth or bootstrap status (for unauthenticated users only)
  const showLoading = isLoading || (!isAuthenticated && isBootstrapLoading);
  if (showLoading) {
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
    <Suspense fallback={<PageLoader />}>
      <Switch>
        {/* Public routes */}
        <Route path="/bootstrap" component={Bootstrap} />
        <Route path="/login" component={LoginPage} />
        <Route path="/unauthorized" component={UnauthorizedPage} />
        <Route path="/sms/optin/:token" component={SmsOptinPage} />

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

      <Route path="/workers/:id/comm/history">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerCommHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/comm/send-sms">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerSendSms />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/comm/send-email">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerSendEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/comm/send-postal">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerSendPostal />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/comm/send-inapp">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerSendInApp />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/comm/:commId">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <CommDetail />
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

      <Route path="/workers/:id/user">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <WorkerUserPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/bans">
        <ProtectedRoute permission="workers.view" component="dispatch">
          <AuthenticatedLayout>
            <WorkerBans />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/union/bargaining-unit">
        <ProtectedRoute permission="workers.view" component="bargainingunits">
          <AuthenticatedLayout>
            <WorkerBargainingUnit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/benefits/history">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerBenefitsHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/benefits/eligibility">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerBenefitsEligibility />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/benefits/scan">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerBenefitsScan />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/union/cardchecks">
        <ProtectedRoute permission="workers.view" component="cardcheck">
          <AuthenticatedLayout>
            <WorkerCardchecks />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/union/steward">
        <ProtectedRoute permission="workers.view" component="worker.steward">
          <AuthenticatedLayout>
            <WorkerSteward />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/union/representatives">
        <ProtectedRoute permission="workers.view" component="worker.steward">
          <AuthenticatedLayout>
            <WorkerRepresentatives />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/dispatch/status">
        <ProtectedRoute permission="workers.view" component="dispatch">
          <AuthenticatedLayout>
            <WorkerDispatchStatus />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/dispatch/do-not-call">
        <ProtectedRoute permission="workers.view" component="dispatch">
          <AuthenticatedLayout>
            <WorkerDispatchDoNotCall />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/dispatch/hold-for-employer">
        <ProtectedRoute permission="workers.view" component="dispatch.hfe">
          <AuthenticatedLayout>
            <WorkerDispatchHoldForEmployer />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/workers/:id/ledger/accounts">
        <ProtectedRoute permission="workers.view" component="ledger">
          <AuthenticatedLayout>
            <WorkerLedgerAccounts />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cardchecks/:id">
        <ProtectedRoute permission="workers.view" component="cardcheck">
          <AuthenticatedLayout>
            <CardcheckViewPage />
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

      <Route path="/hours/:hoursId">
        <ProtectedRoute permission="workers.view">
          <WorkerHoursView />
        </ProtectedRoute>
      </Route>

      <Route path="/hours/:hoursId/edit">
        <ProtectedRoute permission="workers.manage">
          <WorkerHoursEdit />
        </ProtectedRoute>
      </Route>

      <Route path="/hours/:hoursId/delete">
        <ProtectedRoute permission="workers.manage">
          <WorkerHoursDelete />
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
        <ProtectedRoute policy="staff">
          <AuthenticatedLayout>
            <Bookmarks />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/alerts/unread">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <AlertsPage activeTab="unread" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/alerts/read">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <AlertsPage activeTab="read" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/alerts/all">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <AlertsPage activeTab="all" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/alerts">
        <ProtectedRoute>
          <AuthenticatedLayout>
            <AlertsRedirect />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/workers">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="Workers" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/employers">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="Employers" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/ledger">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="Ledger" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/compliance">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="Compliance" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/btu">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <Reports activeCategory="BTU" />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports/:reportType">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ReportType />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/reports">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <Reports />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/monthly-uploads">
        <ProtectedRoute permission="admin">
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
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <EmployerWizards />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/wizards/:id">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <WizardView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <EAView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id/invoices">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <EAInvoices />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id/payments">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <EAPayments />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ea/:id/transactions">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <EATransactions />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/payment/:id">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <PaymentView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/payment/:id/edit">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
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

      <Route path="/employer-contacts/:id/comm/history">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerContactCommHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/comm/send-sms">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerContactSendSms />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/comm/send-email">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerContactSendEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/comm/send-postal">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerContactSendPostal />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employer-contacts/:id/comm/send-inapp">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerContactSendInApp />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/ledger/stripe/customer">
        <ProtectedRoute permission="admin" component="ledger">
          <AuthenticatedLayout>
            <StripeCustomerPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/ledger/stripe/payment_methods">
        <ProtectedRoute policy="ledgerStripeEmployer" component="ledger">
          <AuthenticatedLayout>
            <StripePaymentMethodsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/ledger/accounts">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
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

      <Route path="/employers/:id/policy-history">
        <ProtectedRoute policy="employerUser">
          <AuthenticatedLayout>
            <EmployerPolicyHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/union/stewards">
        <ProtectedRoute policy="employerUser" component="worker.steward">
          <AuthenticatedLayout>
            <EmployerStewards />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/employers/:id/dispatch">
        <ProtectedRoute policy="employerUser" component="dispatch">
          <AuthenticatedLayout>
            <EmployerDispatchPage />
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

      <Route path="/events/new">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events/:id/edit">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events/:id/delete">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventDeletePage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events/:id/register">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventRegisterPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events/:id/roster">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventRosterPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events/:id/self-register">
        <ProtectedRoute component="event">
          <AuthenticatedLayout>
            <EventSelfRegisterPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events/:id">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/events">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <EventsListPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* BTU Site-specific routes */}
      <Route path="/sitespecific/btu/csgs/new">
        <ProtectedRoute permission="admin" component="sitespecific.btu">
          <AuthenticatedLayout>
            <BtuCsgNewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sitespecific/btu/csg/:id/edit">
        <ProtectedRoute permission="admin" component="sitespecific.btu">
          <AuthenticatedLayout>
            <BtuCsgEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sitespecific/btu/csg/:id">
        <ProtectedRoute permission="admin" component="sitespecific.btu">
          <AuthenticatedLayout>
            <BtuCsgViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sitespecific/btu/csgs">
        <ProtectedRoute permission="admin" component="sitespecific.btu">
          <AuthenticatedLayout>
            <BtuCsgListPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sitespecific/btu/employer-map">
        <ProtectedRoute permission="admin" component="sitespecific.btu">
          <AuthenticatedLayout>
            <BtuEmployerMapListPage />
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

      <Route path="/policies/:id/edit">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <PolicyEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/policies/:id/benefits">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <PolicyBenefits />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/policies/:id">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <PolicyView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cardcheck-definitions">
        <ProtectedRoute permission="workers.view" component="cardcheck">
          <AuthenticatedLayout>
            <CardcheckDefinitionsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cardcheck-definitions/:id/edit">
        <ProtectedRoute permission="workers.manage" component="cardcheck">
          <AuthenticatedLayout>
            <CardcheckDefinitionEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cardcheck-definitions/:id">
        <ProtectedRoute permission="workers.view" component="cardcheck">
          <AuthenticatedLayout>
            <CardcheckDefinitionViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id/logs">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderLogsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/user">
        <ProtectedRoute policy="trustProviderUserManage" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactUser />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/addresses">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactAddresses />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/phone-numbers">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactPhoneNumbers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/email">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/name">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactName />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/edit">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/comm/history">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactCommHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/comm/send-sms">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactSendSms />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/comm/send-email">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactSendEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/comm/send-postal">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactSendPostal />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id/comm/send-inapp">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactSendInApp />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust-provider-contacts/:id">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id/contacts">
        <ProtectedRoute policy="staff" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderContactsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id/edit">
        <ProtectedRoute permission="workers.manage" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/provider/:id">
        <ProtectedRoute permission="workers.view" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProviderViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/trust/providers">
        <ProtectedRoute permission="workers.view" component="trust.providers">
          <AuthenticatedLayout>
            <TrustProvidersPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Bargaining Units routes */}
      <Route path="/bargaining-units/:id/edit">
        <ProtectedRoute policy="staff" component="bargainingunits">
          <AuthenticatedLayout>
            <BargainingUnitEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/bargaining-units/:id/delete">
        <ProtectedRoute policy="staff" component="bargainingunits">
          <AuthenticatedLayout>
            <BargainingUnitDeletePage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/bargaining-units/:id">
        <ProtectedRoute policy="staff" component="bargainingunits">
          <AuthenticatedLayout>
            <BargainingUnitViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/bargaining-units">
        <ProtectedRoute policy="staff" component="bargainingunits">
          <AuthenticatedLayout>
            <BargainingUnitsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Stewards route */}
      <Route path="/stewards">
        <ProtectedRoute permission="workers.view" component="worker.steward">
          <AuthenticatedLayout>
            <Stewards />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Admin user management routes - no ConfigurationLayout sidebar */}
      <Route path="/admin/users/list">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UsersListPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users/roles">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <RolesPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users/permissions">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <PermissionsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users/policies">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <PoliciesPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/employers/user-settings">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EmployerUserSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/trust/providers/user-settings">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <TrustProviderUserSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/workers/user-settings">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <WorkerUserSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users/sessions">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <SessionsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users/flood-events">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <FloodEventsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/users/flood-events/config">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <FloodEventsConfigPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Redirect /admin/users to list */}
      <Route path="/admin/users">
        <Redirect to="/admin/users/list" />
      </Route>

      {/* Redirect old /config/users paths to new /admin/users paths */}
      <Route path="/config/users/list">
        <Redirect to="/admin/users/list" />
      </Route>
      <Route path="/config/users/roles">
        <Redirect to="/admin/users/roles" />
      </Route>
      <Route path="/config/users/permissions">
        <Redirect to="/admin/users/permissions" />
      </Route>
      <Route path="/config/users/policies">
        <Redirect to="/admin/users/policies" />
      </Route>
      <Route path="/config/users/sessions">
        <Redirect to="/admin/users/sessions" />
      </Route>
      <Route path="/config/users/flood-events">
        <Redirect to="/admin/users/flood-events" />
      </Route>
      <Route path="/config/users">
        <Redirect to="/admin/users/list" />
      </Route>

      <Route path="/config/addresses">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PostalAddressesConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/phone-numbers">
        <ProtectedRoute permission="admin">
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

      <Route path="/config/steward-settings">
        <ProtectedRoute permission="admin" component="worker.steward">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <StewardSettingsPage />
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

      <Route path="/config/employer-types">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EmployerTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/event-types">
        <ProtectedRoute permission="admin" component="event">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EventTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dispatch-job-types">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <DispatchJobTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dispatch-job-type/:id">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobTypeViewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dispatch-job-type/:id/edit">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobTypeEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dispatch-job-type/:id/plugins">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobTypePluginsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dispatch-job-type/:id/delete">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobTypeDeletePage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/dispatch/dnc">
        <ProtectedRoute permission="admin" component="dispatch.dnc">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <DispatchDncConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/workers/ban">
        <ProtectedRoute permission="admin" component="worker.ban">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <WorkerBanConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/dispatch/jobs">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/dispatch/job/new">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobNewPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/dispatch/job/:id">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobDetailsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/dispatch/job/:id/edit">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobEditPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/dispatch/job/:id/dispatches">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobDispatchesPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/dispatch/job/:id/eligible-workers">
        <ProtectedRoute permission="admin" component="dispatch">
          <AuthenticatedLayout>
            <DispatchJobEligibleWorkersPage />
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

      <Route path="/config/terminology">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <TerminologyConfigPage />
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

      <Route path="/admin/users/masquerade">
        <ProtectedRoute policy="masquerade">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <MasqueradePage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/system-mode">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <SystemModePage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/policies">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PoliciesConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/bargaining-units">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <BargainingUnitsConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/default-policy">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <DefaultPolicyPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/twilio">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <TwilioConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/email">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <EmailConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/postal">
        <ProtectedRoute policy="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PostalConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/logs">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <LogsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/stripe/settings">
        <ProtectedRoute policy="ledgerStripeAdmin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <StripeSettingsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/stripe/test">
        <ProtectedRoute policy="ledgerStripeAdmin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <StripeTestPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/stripe/payment-types">
        <ProtectedRoute policy="ledgerStripeAdmin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PaymentTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/payment-types">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <LedgerPaymentTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/charge-plugins">
        <ProtectedRoute permission="admin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ChargePluginsListPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/charge-plugins/:pluginId/new">
        <ProtectedRoute permission="admin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ChargePluginFormPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/charge-plugins/:pluginId/edit/:configId">
        <ProtectedRoute permission="admin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ChargePluginFormPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/config/ledger/charge-plugins/:pluginId">
        <ProtectedRoute permission="admin" component="ledger">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ChargePluginConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Ledger account detail pages */}
      <Route path="/ledger/accounts/:id/payments">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <AccountPayments />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/transactions">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <AccountTransactions />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/participants">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <AccountParticipants />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/settings">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <AccountSettings />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id/edit">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <LedgerAccountEdit />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts/:id">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <LedgerAccountView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/ledger/accounts">
        <ProtectedRoute policy="ledgerStaff" component="ledger">
          <AuthenticatedLayout>
            <LedgerAccountsPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* User detail page */}
      <Route path="/users/:id">
        <ProtectedRoute permission="admin">
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

      {/* User Contact sub-tabs */}
      <Route path="/users/:id/contact/email">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/contact/phone-numbers">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserPhoneNumbers />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/contact/addresses">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserAddresses />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* User Comm sub-tabs */}
      <Route path="/users/:id/comm/history">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserCommHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/comm/send-sms">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserSendSms />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/comm/send-email">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserSendEmail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/comm/send-postal">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserSendPostal />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/users/:id/comm/send-inapp">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <UserSendInApp />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* Legacy admin routes - redirect user detail to /users/:id */}
      <Route path="/admin/users/:id">
        <Redirect to="/users/:id" />
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
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminRolesPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/permissions">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminPermissionsPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/quickstarts">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <AdminQuickstarts />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/wmb-scan-queue">
        <ProtectedRoute permission="admin" component="trust.benefits.scan">
          <AuthenticatedLayout>
            <WmbScanQueue />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/admin/wmb-scan/:id">
        <ProtectedRoute permission="admin" component="trust.benefits.scan">
          <AuthenticatedLayout>
            <WmbScanDetail />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name/view">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <CronJobView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name/settings">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <CronJobSettings />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name/history">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <CronJobHistory />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/cron-jobs/:name">
        {(params) => <Redirect to={`/cron-jobs/${params.name}/view`} />}
      </Route>

      <Route path="/cron-jobs">
        <ProtectedRoute permission="admin">
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
        <Redirect to="/config" />
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

      {/* Configuration landing page */}
      <Route path="/config">
        <ProtectedRoute permission="admin">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ConfigurationLandingPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>

      {/* 404 for unmatched routes */}
      <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <TerminologyProvider>
            <Toaster />
            <Router />
          </TerminologyProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
