import { lazy, Suspense } from "react";
import ProtectedRoute from "@/components/auth/ProtectedRoute";

const Bearer = lazy(() => import("./pages/config/ws/client-freeman-bearer-authorization"));

export function BearerRoute() { return <ProtectedRoute permission="admin" component="sitespecific.freeman.authorization"><Suspense fallback={null}><Bearer /></Suspense></ProtectedRoute>; }
