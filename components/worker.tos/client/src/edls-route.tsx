import { lazy } from "react";
const Guard = lazy(() => import("@/components/auth/ProtectedRoute"));
const Layout = lazy(() => import("@/components/layouts/AuthenticatedLayout"));
const Page = lazy(() => import("./pages/edls/tos"));
export default function EdlsTosRoute() {
  return <Guard policy="edls.any" component="worker.tos"><Layout><Page /></Layout></Guard>;
}
