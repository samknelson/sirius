import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Save } from "lucide-react";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { useSiteSettings, useSetVariable, useVariableValue } from "@/lib/use-variable";
import { sanitizeHtml } from "@shared/utils/html";
import { useQuery } from "@tanstack/react-query";
import { queryClient, getApiErrorMessage } from "@/lib/queryClient";
import { DEFAULT_MENU_PLUGIN_ID, SITE_MENU_PLUGIN_VARIABLE, type ResolvedMenu, type ResolvedMenuItem } from "@shared/menu-types";
import { useTerm } from "@/contexts/TerminologyContext";

interface MenuManifestEntry {
  id: string;
  name: string;
  description: string;
}

export default function SiteInformation() {
  const { toast } = useToast();
  const [siteName, setSiteName] = useState("");
  const [siteTitle, setSiteTitle] = useState("");
  const [footer, setFooter] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingFooter, setIsEditingFooter] = useState(false);
  const [loginTitle, setLoginTitle] = useState("");
  const [loginIntro, setLoginIntro] = useState("");
  const [isEditingLoginTitle, setIsEditingLoginTitle] = useState(false);
  const [isEditingLoginIntro, setIsEditingLoginIntro] = useState(false);

  const settings = useSiteSettings();
  const loginTitleQuery = useVariableValue("login_page_title");
  const loginIntroQuery = useVariableValue("login_page_intro");
  const savedLoginTitle = typeof loginTitleQuery.data === "string" ? loginTitleQuery.data : "";
  const savedLoginIntro = typeof loginIntroQuery.data === "string" ? loginIntroQuery.data : "";
  const isLoading = settings.isLoading || loginTitleQuery.isLoading || loginIntroQuery.isLoading;

  // Update local state when settings are loaded
  useEffect(() => {
    if (!isLoading && !isEditingName && !isEditingTitle && !isEditingFooter && !isEditingLoginTitle && !isEditingLoginIntro) {
      setSiteName(settings.siteName);
      setSiteTitle(settings.siteTitle || "");
      setFooter(settings.footer || "");
      setLoginTitle(savedLoginTitle);
      setLoginIntro(savedLoginIntro);
    }
  }, [isLoading, settings.siteName, settings.siteTitle, settings.footer, savedLoginTitle, savedLoginIntro, isEditingName, isEditingTitle, isEditingFooter, isEditingLoginTitle, isEditingLoginIntro]);

  const onSaved = () => {
    setIsEditingName(false);
    setIsEditingTitle(false);
    setIsEditingFooter(false);
    setIsEditingLoginTitle(false);
    setIsEditingLoginIntro(false);
    toast({
      title: "Settings saved",
      description: "Site settings have been updated successfully.",
    });
  };
  const onSaveError = (error: unknown) => {
    toast({
      title: "Error",
      description: getApiErrorMessage(error, "Failed to update site settings."),
      variant: "destructive",
    });
  };

  // Main menu plugin selection
  const { data: menuManifest } = useQuery<MenuManifestEntry[]>({
    queryKey: ["/api/plugins/menu/manifest"],
  });
  const menuPluginValue = useVariableValue(SITE_MENU_PLUGIN_VARIABLE);
  const savedMenuPlugin =
    typeof menuPluginValue.data === "string" && menuPluginValue.data
      ? menuPluginValue.data
      : DEFAULT_MENU_PLUGIN_ID;
  const saveMenuPluginMutation = useSetVariable(SITE_MENU_PLUGIN_VARIABLE, {
    onSuccess: () => {
      setPendingMenuPlugin(null);
      queryClient.invalidateQueries({ queryKey: ["/api/menu"] });
      toast({
        title: "Main menu updated",
        description: "The site navigation menu has been changed.",
      });
    },
    onError: onSaveError,
  });

  // Preview a different layout (for the current admin) before applying it
  const [pendingMenuPlugin, setPendingMenuPlugin] = useState<string | null>(null);
  const selectedMenuPlugin = pendingMenuPlugin ?? savedMenuPlugin;
  const isPreviewingMenu = pendingMenuPlugin !== null && pendingMenuPlugin !== savedMenuPlugin;
  const menuPreview = useQuery<ResolvedMenu>({
    queryKey: ["/api/menu", { plugin: selectedMenuPlugin }],
    enabled: isPreviewingMenu,
  });
  const term = useTerm();
  const menuItemLabel = (item: ResolvedMenuItem): string => {
    if (item.labelTerm) {
      return term(item.labelTerm.key, { plural: item.labelTerm.plural });
    }
    return item.label || item.id;
  };

  const saveNameMutation = useSetVariable("site_name", { onSuccess: onSaved, onError: onSaveError });
  const saveTitleMutation = useSetVariable("site_title", { onSuccess: onSaved, onError: onSaveError });
  const saveFooterMutation = useSetVariable("site_footer", { onSuccess: onSaved, onError: onSaveError });
  const saveLoginTitleMutation = useSetVariable("login_page_title", { onSuccess: onSaved, onError: onSaveError });
  const saveLoginIntroMutation = useSetVariable("login_page_intro", { onSuccess: onSaved, onError: onSaveError });

  const updateMutation = {
    isPending:
      saveNameMutation.isPending ||
      saveTitleMutation.isPending ||
      saveFooterMutation.isPending ||
      saveLoginTitleMutation.isPending ||
      saveLoginIntroMutation.isPending,
  };

  const handleSaveName = () => {
    if (!siteName.trim()) {
      toast({
        title: "Validation error",
        description: "Site name cannot be empty.",
        variant: "destructive",
      });
      return;
    }
    saveNameMutation.mutate(siteName);
  };

  const handleSaveTitle = () => {
    if (siteTitle.length > 50) {
      toast({
        title: "Validation error",
        description: "Site title must be 50 characters or less.",
        variant: "destructive",
      });
      return;
    }
    saveTitleMutation.mutate(siteTitle);
  };

  const handleSaveFooter = () => {
    saveFooterMutation.mutate(footer);
  };

  const handleCancelName = () => {
    setSiteName(settings?.siteName || "");
    setIsEditingName(false);
  };

  const handleCancelTitle = () => {
    setSiteTitle(settings?.siteTitle || "");
    setIsEditingTitle(false);
  };

  const handleCancelFooter = () => {
    setFooter(settings?.footer || "");
    setIsEditingFooter(false);
  };

  const handleSaveLoginTitle = () => {
    saveLoginTitleMutation.mutate(loginTitle);
  };

  const handleSaveLoginIntro = () => {
    saveLoginIntroMutation.mutate(loginIntro);
  };

  const handleCancelLoginTitle = () => {
    setLoginTitle(savedLoginTitle);
    setIsEditingLoginTitle(false);
  };

  const handleCancelLoginIntro = () => {
    setLoginIntro(savedLoginIntro);
    setIsEditingLoginIntro(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
      </div>
    );
  }

  return (
    <div className="container mx-auto py-8 max-w-4xl">
      <h1 className="text-2xl md:text-3xl font-bold mb-6" data-testid="heading-site-information">
        Site Information
      </h1>
      
      <Card>
        <CardHeader>
          <CardTitle>General Settings</CardTitle>
          <CardDescription>
            Configure basic information about your site
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="site-name">Site Name</Label>
            {isEditingName ? (
              <div className="space-y-2">
                <Input
                  id="site-name"
                  value={siteName}
                  onChange={(e) => setSiteName(e.target.value)}
                  placeholder="Enter site name"
                  data-testid="input-site-name"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveName}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-name"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelName}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-name"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="px-3 py-2 bg-muted rounded-md"
                  data-testid="text-site-name"
                >
                  {settings?.siteName}
                </div>
                <Button
                  onClick={() => setIsEditingName(true)}
                  data-testid="button-edit-name"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="site-title-input">Title Bar Site Name (max 50 characters)</Label>
            {isEditingTitle ? (
              <div className="space-y-2">
                <Input
                  id="site-title-input"
                  value={siteTitle}
                  onChange={(e) => setSiteTitle(e.target.value)}
                  placeholder="Enter title bar site name"
                  maxLength={50}
                  data-testid="input-site-title"
                />
                <div className="text-sm text-muted-foreground">
                  {siteTitle.length}/50 characters
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveTitle}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-title"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelTitle}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-title"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="px-3 py-2 bg-muted rounded-md"
                  data-testid="text-site-title"
                >
                  {settings?.siteTitle || <em className="text-muted-foreground">Not set</em>}
                </div>
                <Button
                  onClick={() => setIsEditingTitle(true)}
                  data-testid="button-edit-title"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Login Page</CardTitle>
          <CardDescription>
            Customize the title and intro text shown on the login page
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="login-page-title">Login Page Title</Label>
            {isEditingLoginTitle ? (
              <div className="space-y-2">
                <Input
                  id="login-page-title"
                  value={loginTitle}
                  onChange={(e) => setLoginTitle(e.target.value)}
                  placeholder={`Welcome to ${settings?.siteName || "the site"}`}
                  data-testid="input-login-title"
                />
                <p className="text-sm text-muted-foreground">
                  Leave empty to use the default: "Welcome to {settings?.siteName}"
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveLoginTitle}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-login-title"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelLoginTitle}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-login-title"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="px-3 py-2 bg-muted rounded-md"
                  data-testid="text-login-title"
                >
                  {savedLoginTitle || (
                    <em className="text-muted-foreground">
                      Not set — defaults to "Welcome to {settings?.siteName}"
                    </em>
                  )}
                </div>
                <Button
                  onClick={() => setIsEditingLoginTitle(true)}
                  data-testid="button-edit-login-title"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <Label>Login Page Intro (HTML)</Label>
            {isEditingLoginIntro ? (
              <div className="space-y-2">
                <SimpleHtmlEditor
                  value={loginIntro}
                  onChange={setLoginIntro}
                  placeholder="Enter login page intro (supports HTML formatting)"
                  data-testid="editor-login-intro"
                />
                <p className="text-sm text-muted-foreground">
                  Leave empty to use the default: "Sign in to access all features."
                </p>
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveLoginIntro}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-login-intro"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelLoginIntro}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-login-intro"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div
                  className="px-3 py-2 bg-muted rounded-md min-h-[60px] prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: savedLoginIntro
                      ? sanitizeHtml(savedLoginIntro, "styled-text")
                      : '<em class="text-muted-foreground">Not set — defaults to "Sign in to access all features."</em>',
                  }}
                  data-testid="text-login-intro"
                />
                <Button
                  onClick={() => setIsEditingLoginIntro(true)}
                  data-testid="button-edit-login-intro"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Main Menu</CardTitle>
          <CardDescription>
            Choose the navigation menu layout shown in the site header
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Label htmlFor="menu-plugin">Menu Layout</Label>
          <Select
            value={selectedMenuPlugin}
            onValueChange={(value) =>
              setPendingMenuPlugin(value === savedMenuPlugin ? null : value)
            }
            disabled={saveMenuPluginMutation.isPending || menuPluginValue.isLoading}
          >
            <SelectTrigger id="menu-plugin" className="max-w-sm" data-testid="select-menu-plugin">
              <SelectValue placeholder="Select a menu layout" />
            </SelectTrigger>
            <SelectContent>
              {(menuManifest ?? []).map((entry) => (
                <SelectItem key={entry.id} value={entry.id} data-testid={`option-menu-plugin-${entry.id}`}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {menuManifest?.find((e) => e.id === selectedMenuPlugin)?.description && (
            <p className="text-sm text-muted-foreground" data-testid="text-menu-plugin-description">
              {menuManifest.find((e) => e.id === selectedMenuPlugin)!.description}
            </p>
          )}
          {isPreviewingMenu && (
            <div className="mt-4 space-y-3">
              <div className="rounded-md border p-4" data-testid="panel-menu-preview">
                <p className="text-sm font-medium mb-2">
                  Preview — how this layout looks for you
                </p>
                {menuPreview.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="loading-menu-preview">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading preview…
                  </div>
                ) : menuPreview.isError ? (
                  <p className="text-sm text-destructive" data-testid="error-menu-preview">
                    Could not load the preview for this layout.
                  </p>
                ) : (menuPreview.data?.items?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="empty-menu-preview">
                    This layout has no visible items for your account.
                  </p>
                ) : (
                  <ul className="space-y-1" data-testid="list-menu-preview">
                    {menuPreview.data!.items.map((item) => (
                      <li key={item.id} data-testid={`preview-menu-item-${item.id}`}>
                        <span className="text-sm">{menuItemLabel(item)}</span>
                        {item.children && item.children.length > 0 && (
                          <ul className="ml-4 mt-1 space-y-0.5 border-l pl-3">
                            {item.children.map((child) => (
                              <li key={child.id} className="text-sm text-muted-foreground" data-testid={`preview-menu-item-${item.id}-${child.id}`}>
                                {menuItemLabel(child)}
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground mt-3">
                  Other users may see different items depending on their permissions.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => saveMenuPluginMutation.mutate(pendingMenuPlugin!)}
                  disabled={saveMenuPluginMutation.isPending || menuPreview.isLoading}
                  data-testid="button-apply-menu-plugin"
                >
                  {saveMenuPluginMutation.isPending && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Apply for everyone
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setPendingMenuPlugin(null)}
                  disabled={saveMenuPluginMutation.isPending}
                  data-testid="button-cancel-menu-plugin"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Footer</CardTitle>
          <CardDescription>
            Customize the footer HTML displayed on all pages
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Footer Content (HTML)</Label>
            {isEditingFooter ? (
              <div className="space-y-2">
                <SimpleHtmlEditor
                  value={footer}
                  onChange={setFooter}
                  placeholder="Enter footer content (supports HTML formatting)"
                  data-testid="editor-footer"
                />
                <div className="flex gap-2">
                  <Button
                    onClick={handleSaveFooter}
                    disabled={updateMutation.isPending}
                    data-testid="button-save-footer"
                  >
                    {updateMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="mr-2 h-4 w-4" />
                        Save
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelFooter}
                    disabled={updateMutation.isPending}
                    data-testid="button-cancel-footer"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {/*
                  Admin preview of the saved site footer. Sanitized under the
                  same `library-default` policy the real footer renders with
                  (client/src/components/layout/Footer.tsx), so the preview and
                  the live footer cannot show different things.
                */}
                <div
                  className="px-3 py-2 bg-muted rounded-md min-h-[120px] prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{
                    __html: footer
                      ? sanitizeHtml(footer, "library-default")
                      : '<em class="text-muted-foreground">No footer content set</em>',
                  }}
                  data-testid="text-footer"
                />
                <Button
                  onClick={() => setIsEditingFooter(true)}
                  data-testid="button-edit-footer"
                >
                  Edit
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
