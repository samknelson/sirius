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
import Workers from "@/pages/workers";
import WorkersAdd from "@/pages/workers-add";
import WorkerView from "@/pages/worker-view";
import WorkerName from "@/pages/worker-name";
import WorkerEmail from "@/pages/worker-email";
import WorkerIDs from "@/pages/worker-ids";
import WorkerBirthDate from "@/pages/worker-birth-date";
import WorkerGender from "@/pages/worker-gender";
import WorkerBenefits from "@/pages/worker-benefits";
import WorkerLogs from "@/pages/worker-logs";
import WorkerAddresses from "@/pages/worker-addresses";
import WorkerPhoneNumbers from "@/pages/worker-phone-numbers";
import Employers from "@/pages/employers";
import EmployersAdd from "@/pages/employers-add";
import EmployerView from "@/pages/employer-view";
import EmployerEdit from "@/pages/employer-edit";
import StripeCustomerPage from "@/pages/employers/stripe-customer";
import StripePaymentMethodsPage from "@/pages/employers/stripe-payment-methods";
import TrustBenefits from "@/pages/trust-benefits";
import TrustBenefitsAdd from "@/pages/trust-benefits-add";
import TrustBenefitView from "@/pages/trust-benefit-view";
import TrustBenefitEdit from "@/pages/trust-benefit-edit";
import AdminUsersPage from "@/pages/admin/users";
import UserAccountPage from "@/pages/admin/user-account";
import AdminRolesPage from "@/pages/admin/roles";
import AdminPermissionsPage from "@/pages/admin/permissions";
import AdminLayout from "@/components/layouts/AdminLayout";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";
import UsersListPage from "@/pages/config/users/list";
import RolesPage from "@/pages/config/users/roles";
import PermissionsPage from "@/pages/config/users/permissions";
import PoliciesPage from "@/pages/config/users/policies";
import PostalAddressesConfigPage from "@/pages/config/addresses";
import PhoneNumbersConfigPage from "@/pages/config/phone-numbers";
import GenderOptionsPage from "@/pages/config/gender-options";
import WorkerIDTypesPage from "@/pages/config/worker-id-types";
import TrustBenefitTypesPage from "@/pages/config/trust-benefit-types";
import MasqueradePage from "@/pages/config/masquerade";
import WelcomeMessagesConfigPage from "@/pages/config/welcome-messages";
import DashboardPluginsConfigPage from "@/pages/config/dashboard-plugins";
import ComponentsConfigPage from "@/pages/config/components";
import StripeTestPage from "@/pages/config/ledger/stripe/test";
import StripeSettingsPage from "@/pages/config/ledger/stripe/settings";
import PaymentTypesPage from "@/pages/config/ledger/stripe/payment-types";
import LedgerPaymentTypesPage from "@/pages/config/ledger-payment-types";
import LedgerAccountsPage from "@/pages/config/ledger/accounts";
import LedgerAccountView from "@/pages/config/ledger/account-view";
import LedgerAccountEdit from "@/pages/config/ledger/account-edit";
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
  const { data: bootstrapData, isLoading: isBootstrapLoading } = useQuery<{ needed: boolean }>({
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
      
      <Route path="/workers/:id/benefits">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerBenefits />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/workers/:id/logs">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <WorkerLogs />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/workers/:id">
        <ProtectedRoute permission="workers.view">
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
      
      <Route path="/employers/:id">
        <ProtectedRoute permission="workers.view">
          <AuthenticatedLayout>
            <EmployerView />
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/employers">
        <ProtectedRoute permission="workers.view">
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
      
      {/* Configuration routes with nested navigation */}
      <Route path="/config/users/list">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <UsersListPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/users/roles">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <RolesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/users/permissions">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PermissionsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/users/policies">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PoliciesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      {/* Redirect old /config/users to new structure */}
      <Route path="/config/users">
        <Redirect to="/config/users/list" />
      </Route>
      
      <Route path="/config/addresses">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PostalAddressesConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/phone-numbers">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <PhoneNumbersConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/gender-options">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <GenderOptionsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/worker-id-types">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <WorkerIDTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/trust-benefit-types">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <TrustBenefitTypesPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/site">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <SiteInformation />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/welcome-messages">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <WelcomeMessagesConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/dashboard-plugins">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <DashboardPluginsConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/components">
        <ProtectedRoute permission="variables.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <ComponentsConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/masquerade">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <MasqueradePage />
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
      
      {/* Ledger account detail pages */}
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
      
      <Route path="/config/ledger/accounts">
        <ProtectedRoute policy="ledgerStaff">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <LedgerAccountsPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      {/* User detail page */}
      <Route path="/users/:id">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <UserAccountPage />
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
      
      <Route path="/config/ledger/accounts/:id">
        <Redirect to="/ledger/accounts/:id" />
      </Route>
      
      <Route path="/admin/roles">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminRolesPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/admin/permissions">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminPermissionsPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
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
