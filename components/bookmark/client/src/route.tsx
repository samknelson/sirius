import ProtectedRoute from "@/components/auth/ProtectedRoute";
import AuthenticatedLayout from "@/components/layouts/AuthenticatedLayout";
import Bookmarks from "./pages/bookmarks";

export default function BookmarkRoute() {
  return <ProtectedRoute policy="staff" component="bookmark">
    <AuthenticatedLayout><Bookmarks /></AuthenticatedLayout>
  </ProtectedRoute>;
}
