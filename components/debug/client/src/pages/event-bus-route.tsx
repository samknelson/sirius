import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import EventBus from "./event-bus";

export default function EventBusRoute() {
  return <ProtectedRoute permission="admin" component="debug"><AuthenticatedLayout><EventBus /></AuthenticatedLayout></ProtectedRoute>;
}
