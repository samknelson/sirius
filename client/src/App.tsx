import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import Header from "@/components/layout/Header";
import LoginPage from "@/pages/login";
import Workers from "@/pages/workers";
import WorkersAdd from "@/pages/workers-add";
import WorkerView from "@/pages/worker-view";
import WorkerName from "@/pages/worker-name";
import WorkerEmail from "@/pages/worker-email";
import WorkerIDs from "@/pages/worker-ids";
import WorkerBirthDate from "@/pages/worker-birth-date";
import WorkerGender from "@/pages/worker-gender";
import WorkerAddresses from "@/pages/worker-addresses";
import WorkerPhoneNumbers from "@/pages/worker-phone-numbers";
import Employers from "@/pages/employers";
import EmployersAdd from "@/pages/employers-add";
import EmployerView from "@/pages/employer-view";
import EmployerEdit from "@/pages/employer-edit";
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
import UserManagementConfigPage from "@/pages/config/users";
import PostalAddressesConfigPage from "@/pages/config/addresses";
import PhoneNumbersConfigPage from "@/pages/config/phone-numbers";
import GenderOptionsPage from "@/pages/config/gender-options";
import WorkerIDTypesPage from "@/pages/config/worker-id-types";
import TrustBenefitTypesPage from "@/pages/config/trust-benefit-types";
import SiteInformation from "@/pages/site-information";
import NotFound from "@/pages/not-found";

function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Header />
      <main>{children}</main>
    </div>
  );
}

function Router() {
  const { isAuthenticated, isLoading } = useAuth();

  return (
    <Switch>
      {/* Public login route */}
      <Route path="/login" component={LoginPage} />
      
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
      <Route path="/config/users/:id">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <UserAccountPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/config/users">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <ConfigurationLayout>
              <UserManagementConfigPage />
            </ConfigurationLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
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
      
      {/* Legacy admin routes - redirect to configuration */}
      <Route path="/admin/users/:id">
        <Redirect to="/config/users/:id" />
      </Route>
      
      <Route path="/admin/users">
        <Redirect to="/config/users" />
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
        <Redirect to="/config/users" />
      </Route>
      
      {/* Configuration route - redirect to users page */}
      <Route path="/config">
        <Redirect to="/config/users" />
      </Route>
      
      {/* Root route - redirect based on auth status */}
      <Route path="/">
        {!isLoading && (isAuthenticated ? <Redirect to="/workers" /> : <Redirect to="/login" />)}
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
