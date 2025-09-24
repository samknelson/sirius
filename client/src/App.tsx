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
import WorkerView from "@/pages/worker-view";
import AdminUsersPage from "@/pages/admin/users";
import UserAccountPage from "@/pages/admin/user-account";
import AdminRolesPage from "@/pages/admin/roles";
import AdminPermissionsPage from "@/pages/admin/permissions";
import AdminAssignmentsPage from "@/pages/admin/assignments";
import AdminLayout from "@/components/layouts/AdminLayout";
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
      
      {/* Admin routes with nested navigation */}
      <Route path="/admin/users/:id">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <AdminLayout>
              <UserAccountPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/admin/users">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminUsersPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
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
      
      <Route path="/admin/assignments">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <AdminLayout>
              <AdminAssignmentsPage />
            </AdminLayout>
          </AuthenticatedLayout>
        </ProtectedRoute>
      </Route>
      
      {/* Legacy admin route - redirect to users page */}
      <Route path="/admin">
        <Redirect to="/admin/users" />
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
