import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Bookmark, User, Building, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { DashboardPluginProps } from "../types";
import type { Bookmark as BookmarkType } from "@shared/schema";

interface EnrichedBookmark extends BookmarkType {
  displayName: string;
}

export function BookmarksPlugin({ userPermissions }: DashboardPluginProps) {
  const hasBookmarkPermission = userPermissions.includes('bookmark') || userPermissions.includes('admin');

  const { data: bookmarks = [], isLoading } = useQuery<EnrichedBookmark[]>({
    queryKey: ["/api/bookmarks/enriched"],
    enabled: hasBookmarkPermission,
  });

  if (!hasBookmarkPermission || isLoading) {
    return null;
  }

  const recentBookmarks = bookmarks.slice(0, 15);

  if (recentBookmarks.length === 0) {
    return null;
  }

  const getBookmarkIcon = (entityType: string) => {
    switch (entityType) {
      case 'worker':
        return User;
      case 'employer':
        return Building;
      default:
        return Bookmark;
    }
  };

  const getBookmarkLink = (bookmark: EnrichedBookmark) => {
    switch (bookmark.entityType) {
      case 'worker':
        return `/workers/${bookmark.entityId}`;
      case 'employer':
        return `/employers/${bookmark.entityId}`;
      default:
        return null;
    }
  };

  return (
    <Card data-testid="plugin-bookmarks">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bookmark className="h-5 w-5" />
          Recent Bookmarks
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {recentBookmarks.map((bookmark) => {
            const link = getBookmarkLink(bookmark);
            const Icon = getBookmarkIcon(bookmark.entityType);
            
            if (link) {
              return (
                <Link
                  key={bookmark.id}
                  href={link}
                  data-testid={`bookmark-link-${bookmark.id}`}
                >
                  <div className="flex items-center gap-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm flex-1 truncate">{bookmark.displayName}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {new Date(bookmark.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </Link>
              );
            }

            return (
              <div
                key={bookmark.id}
                className="flex items-center gap-3 p-2 rounded-md"
                data-testid={`bookmark-item-${bookmark.id}`}
              >
                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <span className="text-sm flex-1 truncate">{bookmark.displayName}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {new Date(bookmark.createdAt).toLocaleDateString()}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
      <CardFooter className="pt-0">
        <Link href="/bookmarks" className="w-full">
          <Button 
            variant="ghost" 
            className="w-full justify-between" 
            data-testid="button-view-all-bookmarks"
          >
            <span>View All Bookmarks</span>
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </CardFooter>
    </Card>
  );
}
