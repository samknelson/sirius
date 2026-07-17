import { useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2, Pencil, Save, X, Layers } from "lucide-react";
import type { ContractArticle } from "@shared/schema";
import { ContractLayout } from "@/components/layouts/ContractLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

function ArticlesEditBody() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();

  const articlesKey = ["/api/contracts", id, "articles"];
  const { data: articles, isLoading } = useQuery<ContractArticle[]>({
    queryKey: articlesKey,
    queryFn: async () => {
      const res = await fetch(`/api/contracts/${id}/articles`);
      if (!res.ok) throw new Error("Failed to load articles");
      return res.json();
    },
  });

  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNumber, setEditNumber] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: articlesKey });

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiRequest("POST", `/api/contracts/${id}/articles`, {
        name: newName.trim(),
        articleNumber: newNumber.trim() || undefined,
      });
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts", id] });
      setNewName("");
      setNewNumber("");
      toast({ title: "Article added" });
    } catch (error) {
      toast({
        title: "Failed to add article",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (article: ContractArticle) => {
    setEditId(article.id);
    setEditName(article.name);
    setEditNumber(article.articleNumber ?? "");
  };

  const handleSaveEdit = async (articleId: string) => {
    if (!editName.trim()) return;
    setBusyId(articleId);
    try {
      await apiRequest("PATCH", `/api/contracts/articles/${articleId}`, {
        name: editName.trim(),
        articleNumber: editNumber.trim(),
      });
      await invalidate();
      setEditId(null);
      toast({ title: "Article updated" });
    } catch (error) {
      toast({
        title: "Failed to update article",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleMove = async (articleId: string, direction: "up" | "down") => {
    setBusyId(articleId);
    try {
      await apiRequest("POST", `/api/contracts/articles/${articleId}/move`, { direction });
      await invalidate();
    } catch (error) {
      toast({
        title: "Failed to reorder",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (articleId: string) => {
    setBusyId(articleId);
    try {
      await apiRequest("DELETE", `/api/contracts/articles/${articleId}`);
      await invalidate();
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts", id] });
      toast({ title: "Article deleted" });
    } catch (error) {
      toast({
        title: "Failed to delete article",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add article</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 w-24">
              <Label htmlFor="new-article-number">Number</Label>
              <Input
                id="new-article-number"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="1"
                data-testid="input-new-article-number"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label htmlFor="new-article-name">Name</Label>
              <Input
                id="new-article-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Wages and Hours"
                data-testid="input-new-article-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating} data-testid="button-add-article">
              {creating ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Plus size={16} className="mr-2" />}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !articles || articles.length === 0 ? (
        <p className="text-muted-foreground text-sm">No articles yet. Add one above.</p>
      ) : (
        <div className="space-y-2">
          {articles.map((article, index) => (
            <Card key={article.id} data-testid={`row-article-${article.id}`}>
              <CardContent className="flex items-center gap-3 py-3">
                <div className="flex flex-col">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={index === 0 || busyId === article.id}
                    onClick={() => handleMove(article.id, "up")}
                    data-testid={`button-move-up-${article.id}`}
                  >
                    <ChevronUp size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    disabled={index === articles.length - 1 || busyId === article.id}
                    onClick={() => handleMove(article.id, "down")}
                    data-testid={`button-move-down-${article.id}`}
                  >
                    <ChevronDown size={16} />
                  </Button>
                </div>

                {editId === article.id ? (
                  <>
                    <Input
                      value={editNumber}
                      onChange={(e) => setEditNumber(e.target.value)}
                      className="w-20"
                      placeholder="No."
                      data-testid={`input-edit-article-number-${article.id}`}
                    />
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1"
                      data-testid={`input-edit-article-name-${article.id}`}
                    />
                    <Button
                      size="icon"
                      className="h-8 w-8"
                      disabled={!editName.trim() || busyId === article.id}
                      onClick={() => handleSaveEdit(article.id)}
                      data-testid={`button-save-article-${article.id}`}
                    >
                      {busyId === article.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Save size={14} />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setEditId(null)}
                      data-testid={`button-cancel-edit-article-${article.id}`}
                    >
                      <X size={14} />
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Layers size={16} className="text-primary shrink-0" />
                      <span className="truncate" data-testid={`text-article-${article.id}`}>
                        {article.articleNumber ? `${article.articleNumber}. ` : ""}
                        {article.name}
                      </span>
                    </div>
                    <Link href={`/contract/${id}/article/${article.id}/edit`}>
                      <Button variant="outline" size="sm" data-testid={`button-sections-${article.id}`}>
                        <Pencil size={14} className="mr-2" />
                        Sections
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => startEdit(article)}
                      data-testid={`button-edit-article-${article.id}`}
                    >
                      <Pencil size={14} />
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          disabled={busyId === article.id}
                          data-testid={`button-delete-article-${article.id}`}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete "{article.name}"?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes the article and all of its sections. This
                            cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => handleDelete(article.id)}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            data-testid={`button-confirm-delete-article-${article.id}`}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContractArticlesEditPage() {
  return (
    <ContractLayout activeTab="articles-edit">
      <ArticlesEditBody />
    </ContractLayout>
  );
}
