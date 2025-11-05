import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Bookmark, Trash2, ArrowUpDown, User, Building } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import type { Bookmark as BookmarkType, Worker, Employer } from "@shared/schema";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SortOption = "name" | "timestamp";

export default function Bookmarks() {
  const { toast } = useToast();
  const [sortBy, setSortBy] = useState<SortOption>("timestamp");
  const [deleteTarget, setDeleteTarget] = useState<BookmarkType | null>(null);

  const { data: bookmarks = [], isLoading: bookmarksLoading } = useQuery<BookmarkType[]>({
    queryKey: ["/api/bookmarks"],
  });

  const { data: workers = [] } = useQuery<Worker[]>({
    queryKey: ["/api/workers"],
    enabled: bookmarks.some(b => b.entityType === 'worker'),
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
    enabled: bookmarks.some(b => b.entityType === 'employer'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (bookmarkId: string) => {
      return apiRequest("DELETE", `/api/bookmarks/${bookmarkId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      toast({
        title: "Bookmark deleted",
        description: "The bookmark has been removed.",
      });
      setDeleteTarget(null);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to delete bookmark",
        variant: "destructive",
      });
    },
  });

  const getBookmarkName = (bookmark: BookmarkType): string => {
    if (bookmark.entityType === 'worker') {
      const worker = workers.find(w => w.id === bookmark.entityId);
      return worker ? `Worker #${worker.siriusId}` : `Worker #${bookmark.entityId.slice(0, 8)}`;
    }
    
    if (bookmark.entityType === 'employer') {
      const employer = employers.find(e => e.id === bookmark.entityId);
      return employer?.name || `Employer #${bookmark.entityId.slice(0, 8)}`;
    }
    
    return `${bookmark.entityType} #${bookmark.entityId.slice(0, 8)}`;
  };

  const getBookmarkLink = (bookmark: BookmarkType): string => {
    switch (bookmark.entityType) {
      case 'worker':
        return `/workers/${bookmark.entityId}`;
      case 'employer':
        return `/employers/${bookmark.entityId}`;
      default:
        return '#';
    }
  };

  const getBookmarkIcon = (bookmark: BookmarkType) => {
    switch (bookmark.entityType) {
      case 'worker':
        return User;
      case 'employer':
        return Building;
      default:
        return Bookmark;
    }
  };

  const sortedBookmarks = [...bookmarks].sort((a, b) => {
    if (sortBy === "name") {
      return getBookmarkName(a).localeCompare(getBookmarkName(b));
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  const toggleSort = () => {
    setSortBy(current => current === "name" ? "timestamp" : "name");
  };

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader 
        title="Bookmarks" 
        icon={<Bookmark className="text-primary-foreground" size={16} />}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={toggleSort}
              data-testid="button-sort-bookmarks"
            >
              <ArrowUpDown className="h-4 w-4 mr-2" />
              Sort by {sortBy === "name" ? "Date" : "Name"}
            </Button>
            <span className="text-sm text-muted-foreground" data-testid="text-bookmark-count">
              {bookmarks.length} {bookmarks.length === 1 ? "Bookmark" : "Bookmarks"}
            </span>
          </div>
        }
      />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {bookmarksLoading ? (
          <div className="text-center text-muted-foreground py-8">
            <p>Loading bookmarks...</p>
          </div>
        ) : bookmarks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Bookmark className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">No bookmarks yet</p>
              <p className="text-sm text-muted-foreground mt-2">
                Bookmark workers and employers to quickly access them later
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {sortedBookmarks.map((bookmark) => {
              const Icon = getBookmarkIcon(bookmark);
              const name = getBookmarkName(bookmark);
              const link = getBookmarkLink(bookmark);
              
              return (
                <Card key={bookmark.id} data-testid={`bookmark-card-${bookmark.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <Link href={link} className="flex-1">
                        <div className="flex items-center gap-3 cursor-pointer hover:text-primary transition-colors">
                          <Icon className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                          <div className="flex-1">
                            <div className="font-medium" data-testid={`bookmark-name-${bookmark.id}`}>
                              {name}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Bookmarked {new Date(bookmark.createdAt).toLocaleDateString()} at{" "}
                              {new Date(bookmark.createdAt).toLocaleTimeString()}
                            </div>
                          </div>
                        </div>
                      </Link>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteTarget(bookmark)}
                        data-testid={`button-delete-${bookmark.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Bookmark</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove this bookmark? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
