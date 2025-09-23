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
import AdminPage from "@/pages/admin";
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
      
      <Route path="/admin">
        <ProtectedRoute permission="admin.manage">
          <AuthenticatedLayout>
            <AdminPage />
          </AuthenticatedLayout>
        </ProtectedRoute>
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
