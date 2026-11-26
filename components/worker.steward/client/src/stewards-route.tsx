import { lazy } from "react";
const Guard = lazy(() => import("@/components/auth/ProtectedRoute"));
const Layout = lazy(() => import("@/components/layouts/AuthenticatedLayout"));
const Page = lazy(() => import("./pages/stewards"));
export default function StewardsRoute() {
  return <Guard permission="staff" component="worker.steward"><Layout><Page /></Layout></Guard>;
}
