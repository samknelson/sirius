import { useState } from "react";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";

interface BookmarkButtonProps {
  entityType: string;
  entityId: string;
  entityName?: string;
}

export function BookmarkButton({ entityType, entityId, entityName }: BookmarkButtonProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  
  // Check if user has bookmark permission or admin access
  const canBookmark = hasPermission('bookmark') || hasPermission('admin');
  
  // Don't render the button if user doesn't have permission
  if (!canBookmark) {
    return null;
  }

  const { data: bookmarkStatus } = useQuery({
    queryKey: ["/api/bookmarks/check", entityType, entityId],
    queryFn: async () => {
      const response = await fetch(`/api/bookmarks/check?entityType=${entityType}&entityId=${entityId}`);
      if (!response.ok) throw new Error("Failed to check bookmark");
      return response.json() as Promise<{ bookmarked: boolean; bookmark: any }>;
    },
  });

  const createBookmark = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/bookmarks", { entityType, entityId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks/check", entityType, entityId] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      toast({
        title: "Bookmarked",
        description: `${entityName || "Item"} has been added to your bookmarks.`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to add bookmark.",
      });
    },
  });

  const deleteBookmark = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/bookmarks/entity/${entityType}/${entityId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks/check", entityType, entityId] });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      toast({
        title: "Removed",
        description: `${entityName || "Item"} has been removed from your bookmarks.`,
      });
    },
    onError: () => {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to remove bookmark.",
      });
    },
  });

  const handleToggle = () => {
    if (bookmarkStatus?.bookmarked) {
      deleteBookmark.mutate();
    } else {
      createBookmark.mutate();
    }
  };

  const isBookmarked = bookmarkStatus?.bookmarked || false;
  const isPending = createBookmark.isPending || deleteBookmark.isPending;

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      disabled={isPending}
      data-testid="button-bookmark"
      className="h-8 w-8 p-0"
    >
      {isBookmarked ? (
        <BookmarkCheck className="text-primary" size={18} data-testid="icon-bookmarked" />
      ) : (
        <Bookmark className="text-muted-foreground" size={18} data-testid="icon-not-bookmarked" />
      )}
    </Button>
  );
}
