import { lazy, Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

const SecondShift = lazy(() => import("./pages/worker-sitespecific-freeman-2shift"));
const CrewLeads = lazy(() => import("./pages/sitespecific/freeman/crewleads-list"));
const Changelog = lazy(() => import("./pages/sitespecific/freeman/changelog"));

export function SecondShiftRoute() { return <ProtectedRoute tabId="sitespecific-freeman-2shift" entityType="worker"><Suspense fallback={null}><SecondShift /></Suspense></ProtectedRoute>; }
export function CrewLeadsRoute() { return <ProtectedRoute policy="edls.any" component="sitespecific.freeman"><Suspense fallback={null}><CrewLeads /></Suspense></ProtectedRoute>; }
export function ChangelogRoute() { return <ProtectedRoute component="sitespecific.freeman"><Suspense fallback={null}><Changelog /></Suspense></ProtectedRoute>; }
