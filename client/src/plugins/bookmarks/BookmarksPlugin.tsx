import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bookmark, User, Building } from "lucide-react";
import { Link } from "wouter";
import { DashboardPluginProps } from "../types";
import type { Bookmark as BookmarkType, Worker, Employer } from "@shared/schema";

interface EnrichedBookmark extends BookmarkType {
  displayName?: string;
  displayIcon?: typeof User;
}

export function BookmarksPlugin({ userPermissions }: DashboardPluginProps) {
  const hasBookmarkPermission = userPermissions.includes('bookmark') || userPermissions.includes('admin');

  const { data: bookmarks = [], isLoading: bookmarksLoading } = useQuery<BookmarkType[]>({
    queryKey: ["/api/bookmarks"],
    enabled: hasBookmarkPermission,
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: hasBookmarkPermission && bookmarks.some(b => b.entityType === 'worker'),
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
    enabled: hasBookmarkPermission && bookmarks.some(b => b.entityType === 'employer'),
  });

  if (!hasBookmarkPermission || bookmarksLoading) {
    return null;
  }

  const recentBookmarks = bookmarks
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 15);

  if (recentBookmarks.length === 0) {
    return null;
  }

  const enrichBookmark = (bookmark: BookmarkType): EnrichedBookmark => {
    if (bookmark.entityType === 'worker') {
      const worker = workers.find(w => w.id === bookmark.entityId);
      if (worker) {
        return {
          ...bookmark,
          displayName: `Worker #${worker.siriusId}`,
          displayIcon: User,
        };
      }
      return {
        ...bookmark,
        displayName: `Worker #${bookmark.entityId.slice(0, 8)}`,
        displayIcon: User,
      };
    }

    if (bookmark.entityType === 'employer') {
      const employer = employers.find(e => e.id === bookmark.entityId);
      if (employer) {
        return {
          ...bookmark,
          displayName: employer.name || `Employer #${bookmark.entityId.slice(0, 8)}`,
          displayIcon: Building,
        };
      }
      return {
        ...bookmark,
        displayName: `Employer #${bookmark.entityId.slice(0, 8)}`,
        displayIcon: Building,
      };
    }

    return {
      ...bookmark,
      displayName: `${bookmark.entityType} #${bookmark.entityId.slice(0, 8)}`,
      displayIcon: Bookmark,
    };
  };

  const getBookmarkLink = (bookmark: BookmarkType) => {
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
            const enriched = enrichBookmark(bookmark);
            const link = getBookmarkLink(bookmark);
            const Icon = enriched.displayIcon || Bookmark;
            
            if (link) {
              return (
                <Link
                  key={bookmark.id}
                  href={link}
                  data-testid={`bookmark-link-${bookmark.id}`}
                >
                  <div className="flex items-center gap-3 p-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer">
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm flex-1 truncate">{enriched.displayName}</span>
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
                <span className="text-sm flex-1 truncate">{enriched.displayName}</span>
                <span className="text-xs text-muted-foreground flex-shrink-0">
                  {new Date(bookmark.createdAt).toLocaleDateString()}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
