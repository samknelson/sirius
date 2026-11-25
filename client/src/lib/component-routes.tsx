import { lazy, type ComponentType } from "react";
import { useParams } from "wouter";
import type { TabEntityType } from "../../../shared/tabRegistry";

// Route declarations are discovered while navigation is being composed.
// Defer layouts/auth views so they cannot read that collection mid-initialization.
const ProtectedRoute = lazy(() => import("../components/auth/ProtectedRoute"));
const AuthenticatedLayout = lazy(() => import("../components/layouts/AuthenticatedLayout"));
const ConfigurationLayout = lazy(() => import("../components/layouts/ConfigurationLayout"));

export function componentTabRoute(Page: ComponentType, tabId: string, entityType: TabEntityType) {
  return function ComponentTabRoute() {
    const { id } = useParams<{ id: string }>();
    return <ProtectedRoute tabId={tabId} entityType={entityType} entityId={id}>
      <AuthenticatedLayout><Page /></AuthenticatedLayout>
    </ProtectedRoute>;
  };
}
export function componentConfigRoute(Page: ComponentType, component: string) {
  return function ComponentConfigRoute() {
    return <ProtectedRoute permission="admin" component={component}>
      <AuthenticatedLayout><ConfigurationLayout><Page /></ConfigurationLayout></AuthenticatedLayout>
    </ProtectedRoute>;
  };
}
