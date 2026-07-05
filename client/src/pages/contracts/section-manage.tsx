import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Loader2,
  Save,
  ArrowLeft,
  List,
} from "lucide-react";
import type { ContractArticle, ContractSection } from "@shared/schema";
import { ContractLayout } from "@/components/layouts/ContractLayout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
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

function SectionEditor({
  section,
  index,
  total,
  onChanged,
}: {
  section: ContractSection;
  index: number;
  total: number;
  onChanged: () => Promise<void> | void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState(section.name);
  const [number, setNumber] = useState(section.sectionNumber ?? "");
  const [body, setBody] = useState(section.body ?? "");
  const [isStub, setIsStub] = useState(section.isStub);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(section.name);
    setNumber(section.sectionNumber ?? "");
    setBody(section.body ?? "");
    setIsStub(section.isStub);
  }, [section.id, section.name, section.sectionNumber, section.body, section.isStub]);

  const dirty =
    name.trim() !== section.name ||
    number !== (section.sectionNumber ?? "") ||
    body !== (section.body ?? "") ||
    isStub !== section.isStub;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await apiRequest("PATCH", `/api/contracts/sections/${section.id}`, {
        name: name.trim(),
        sectionNumber: number.trim(),
        body,
        isStub,
      });
      await onChanged();
      toast({ title: "Section saved" });
    } catch (error) {
      toast({
        title: "Failed to save section",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleMove = async (direction: "up" | "down") => {
    setBusy(true);
    try {
      await apiRequest("POST", `/api/contracts/sections/${section.id}/move`, { direction });
      await onChanged();
    } catch (error) {
      toast({
        title: "Failed to reorder",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      await apiRequest("DELETE", `/api/contracts/sections/${section.id}`);
      await onChanged();
      toast({ title: "Section deleted" });
    } catch (error) {
      toast({
        title: "Failed to delete section",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setBusy(false);
    }
  };

  return (
    <Card data-testid={`card-section-${section.id}`}>
      <CardContent className="py-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="flex flex-col pt-6">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={index === 0 || busy}
              onClick={() => handleMove("up")}
              data-testid={`button-move-up-section-${section.id}`}
            >
              <ChevronUp size={16} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              disabled={index === total - 1 || busy}
              onClick={() => handleMove("down")}
              data-testid={`button-move-down-section-${section.id}`}
            >
              <ChevronDown size={16} />
            </Button>
          </div>
          <div className="flex-1 space-y-3">
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1 w-24">
                <Label>Number</Label>
                <Input
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="1.1"
                  data-testid={`input-section-number-${section.id}`}
                />
              </div>
              <div className="space-y-1 flex-1 min-w-[200px]">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid={`input-section-name-${section.id}`}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Body</Label>
              <SimpleHtmlEditor
                value={body}
                onChange={setBody}
                placeholder="Section text..."
                minHeight={140}
                data-testid={`editor-section-body-${section.id}`}
              />
            </div>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch
                  checked={isStub}
                  onCheckedChange={setIsStub}
                  id={`stub-${section.id}`}
                  data-testid={`switch-section-stub-${section.id}`}
                />
                <Label htmlFor={`stub-${section.id}`} className="text-sm">
                  Stub section
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={busy}
                      data-testid={`button-delete-section-${section.id}`}
                    >
                      <Trash2 size={14} className="mr-2" />
                      Delete
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{section.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes the section. This cannot be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={handleDelete}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        data-testid={`button-confirm-delete-section-${section.id}`}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
                <Button
                  size="sm"
                  onClick={handleSave}
                  disabled={!dirty || !name.trim() || saving}
                  data-testid={`button-save-section-${section.id}`}
                >
                  {saving ? (
                    <Loader2 size={14} className="mr-2 animate-spin" />
                  ) : (
                    <Save size={14} className="mr-2" />
                  )}
                  Save
                </Button>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionManageBody() {
  const { id, articleId } = useParams<{ id: string; articleId: string }>();
  const { toast } = useToast();

  const { data: article, isLoading: articleLoading } = useQuery<ContractArticle>({
    queryKey: ["/api/contracts/articles", articleId],
    queryFn: async () => {
      const res = await fetch(`/api/contracts/articles/${articleId}`);
      if (!res.ok) throw new Error("Article not found");
      return res.json();
    },
  });

  const sectionsKey = ["/api/contracts/articles", articleId, "sections"];
  const { data: sections, isLoading: sectionsLoading } = useQuery<ContractSection[]>({
    queryKey: sectionsKey,
    queryFn: async () => {
      const res = await fetch(`/api/contracts/articles/${articleId}/sections`);
      if (!res.ok) throw new Error("Failed to load sections");
      return res.json();
    },
  });

  const [newName, setNewName] = useState("");
  const [newNumber, setNewNumber] = useState("");
  const [creating, setCreating] = useState(false);

  const [articleName, setArticleName] = useState("");
  const [articleNumber, setArticleNumber] = useState("");
  const [savingArticle, setSavingArticle] = useState(false);

  useEffect(() => {
    if (article) {
      setArticleName(article.name);
      setArticleNumber(article.articleNumber ?? "");
    }
  }, [article?.id, article?.name, article?.articleNumber]);

  const articleDirty =
    !!article &&
    (articleName.trim() !== article.name || articleNumber !== (article.articleNumber ?? ""));

  const refreshSections = async () => {
    await queryClient.invalidateQueries({ queryKey: sectionsKey });
    await queryClient.invalidateQueries({ queryKey: ["/api/contracts", id] });
  };

  const handleSaveArticle = async () => {
    if (!articleName.trim()) return;
    setSavingArticle(true);
    try {
      await apiRequest("PATCH", `/api/contracts/articles/${articleId}`, {
        name: articleName.trim(),
        articleNumber: articleNumber.trim(),
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts/articles", articleId] });
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts", id] });
      toast({ title: "Article saved" });
    } catch (error) {
      toast({
        title: "Failed to save article",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingArticle(false);
    }
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await apiRequest("POST", `/api/contracts/articles/${articleId}/sections`, {
        name: newName.trim(),
        sectionNumber: newNumber.trim() || undefined,
      });
      await refreshSections();
      setNewName("");
      setNewNumber("");
      toast({ title: "Section added" });
    } catch (error) {
      toast({
        title: "Failed to add section",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href={`/contract/${id}/articles/edit`}>
          <Button variant="ghost" size="sm" data-testid="button-back-to-articles">
            <ArrowLeft size={14} className="mr-2" />
            Back to Articles
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Article details</CardTitle>
        </CardHeader>
        <CardContent>
          {articleLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1 w-24">
                <Label htmlFor="article-number">Number</Label>
                <Input
                  id="article-number"
                  value={articleNumber}
                  onChange={(e) => setArticleNumber(e.target.value)}
                  placeholder="1"
                  data-testid="input-article-number"
                />
              </div>
              <div className="space-y-1 flex-1 min-w-[200px]">
                <Label htmlFor="article-name">Name</Label>
                <Input
                  id="article-name"
                  value={articleName}
                  onChange={(e) => setArticleName(e.target.value)}
                  data-testid="input-article-name"
                />
              </div>
              <Button
                onClick={handleSaveArticle}
                disabled={!articleDirty || !articleName.trim() || savingArticle}
                data-testid="button-save-article"
              >
                {savingArticle ? (
                  <Loader2 size={16} className="mr-2 animate-spin" />
                ) : (
                  <Save size={16} className="mr-2" />
                )}
                Save
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add section</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1 w-24">
              <Label htmlFor="new-section-number">Number</Label>
              <Input
                id="new-section-number"
                value={newNumber}
                onChange={(e) => setNewNumber(e.target.value)}
                placeholder="1.1"
                data-testid="input-new-section-number"
              />
            </div>
            <div className="space-y-1 flex-1 min-w-[200px]">
              <Label htmlFor="new-section-name">Name</Label>
              <Input
                id="new-section-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Overtime"
                data-testid="input-new-section-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <Button onClick={handleCreate} disabled={!newName.trim() || creating} data-testid="button-add-section">
              {creating ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Plus size={16} className="mr-2" />}
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {sectionsLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-48 w-full" />
          ))}
        </div>
      ) : !sections || sections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <List className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">No sections yet</h3>
            <p className="text-muted-foreground text-center text-sm">Add a section above.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {sections.map((section, index) => (
            <SectionEditor
              key={section.id}
              section={section}
              index={index}
              total={sections.length}
              onChanged={refreshSections}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function ContractSectionManagePage() {
  return (
    <ContractLayout activeTab="articles">
      <SectionManageBody />
    </ContractLayout>
  );
}
