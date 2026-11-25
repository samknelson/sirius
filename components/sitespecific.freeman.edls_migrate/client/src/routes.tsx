import { lazy, Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";

const Migrate = lazy(() => import("./pages/admin/sitespecific/freeman/edls-migrate"));

export function MigrationRoute() { return <ProtectedRoute permission="admin" componentAll={["edls", "sitespecific.freeman", "sitespecific.freeman.edls_migrate"]}><ConfigurationLayout><Suspense fallback={null}><Migrate /></Suspense></ConfigurationLayout></ProtectedRoute>; }
