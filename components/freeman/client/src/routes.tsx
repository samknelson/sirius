import { lazy, Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";
import ConfigurationLayout from "@/components/layouts/ConfigurationLayout";

const SecondShift = lazy(() => import("./pages/worker-sitespecific-freeman-2shift"));
const Migrate = lazy(() => import("./pages/admin/sitespecific/freeman/edls-migrate"));
const Bearer = lazy(() => import("./pages/config/ws/client-freeman-bearer-authorization"));
const CrewLeads = lazy(() => import("./pages/sitespecific/freeman/crewleads-list"));
const Changelog = lazy(() => import("./pages/sitespecific/freeman/changelog"));


export function SecondShiftRoute() { return <ProtectedRoute tabId="sitespecific-freeman-2shift" entityType="worker"><Suspense fallback={null}><SecondShift /></Suspense></ProtectedRoute>; }
export function MigrationRoute() { return <ProtectedRoute permission="admin" componentAll={["edls", "sitespecific.freeman", "sitespecific.freeman.edls_migrate"]}><ConfigurationLayout><Suspense fallback={null}><Migrate /></Suspense></ConfigurationLayout></ProtectedRoute>; }
export function BearerRoute() { return <ProtectedRoute permission="admin" component="sitespecific.freeman.authorization"><Suspense fallback={null}><Bearer /></Suspense></ProtectedRoute>; }
export function CrewLeadsRoute() { return <ProtectedRoute policy="edls.any" component="sitespecific.freeman"><Suspense fallback={null}><CrewLeads /></Suspense></ProtectedRoute>; }
export function ChangelogRoute() { return <ProtectedRoute component="sitespecific.freeman"><Suspense fallback={null}><Changelog /></Suspense></ProtectedRoute>; }
