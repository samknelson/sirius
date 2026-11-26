import { Bookmark } from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

export default function ProfileItem() {
  const { hasPermission } = useAuth();
  if (!hasPermission("bookmark") && !hasPermission("admin")) return null;
  return <>
    <DropdownMenuItem asChild>
      <Link href="/bookmarks" className="w-full">
        <div className="flex items-center cursor-pointer" data-testid="menu-bookmarks">
          <Bookmark className="h-4 w-4 mr-2" />Bookmarks
        </div>
      </Link>
    </DropdownMenuItem>
    <DropdownMenuSeparator />
  </>;
}
