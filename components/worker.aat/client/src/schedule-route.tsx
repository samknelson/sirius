import { lazy } from "react";
import { useAuth } from "@/contexts/AuthContext";
const Page = lazy(() => import("./pages/edls-schedule"));
const Layout = lazy(() => import("@/components/layouts/AuthenticatedLayout"));
export default function ScheduleRoute() {
  const { isAuthenticated, authReady } = useAuth();
  if (!authReady) return <div role="status">Loading…</div>;
  return isAuthenticated ? <Layout><Page /></Layout> : <Page />;
}
