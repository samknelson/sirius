import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen } from "lucide-react";

interface FileSystemInfo {
  id: string;
  name: string;
  description: string | null;
  access: string | null;
  provider: string | null;
  configured: boolean;
}

function defaultDescription(fs: FileSystemInfo): string {
  if (!fs.configured) {
    return "Referenced by file records but not configured in the FILESYSTEMS environment variable.";
  }
  const providerLabel =
    fs.provider === "replit" ? "Replit object storage" : fs.provider === "s3" ? "S3" : "Local";
  return `${providerLabel} filesystem (${fs.access})`;
}

export default function FileBrowserPage() {
  usePageTitle("File Browser");

  const { data: filesystems = [], isLoading } = useQuery<FileSystemInfo[]>({
    queryKey: ["/api/admin/filesystems"],
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-foreground" data-testid="text-page-title">
          File Browser
        </h1>
        <p className="text-muted-foreground mt-2">
          Raw view of the configured filesystems. Choose a filesystem to browse its
          contents; files without a database record are flagged.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-8 w-8 animate-spin" data-testid="loading-spinner" />
        </div>
      ) : filesystems.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-center text-muted-foreground" data-testid="text-no-filesystems">
              No filesystems are configured. An operator must define them in the
              FILESYSTEMS environment variable.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filesystems.map((fs) => (
            <Card key={fs.id} data-testid={`card-filesystem-${fs.id}`}>
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-lg" data-testid={`text-fs-name-${fs.id}`}>
                    {fs.name}
                  </CardTitle>
                  {fs.configured ? (
                    <Badge variant="secondary" data-testid={`badge-configured-${fs.id}`}>
                      Configured
                    </Badge>
                  ) : (
                    <Badge variant="destructive" data-testid={`badge-configured-${fs.id}`}>
                      Not configured
                    </Badge>
                  )}
                </div>
                <CardDescription data-testid={`text-fs-description-${fs.id}`}>
                  {fs.description || defaultDescription(fs)}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant="outline">id: {fs.id}</Badge>
                  {fs.configured && (
                    <>
                      <Badge variant="outline">provider: {fs.provider}</Badge>
                      <Badge variant="outline">access: {fs.access}</Badge>
                    </>
                  )}
                </div>
                <Link href={`/admin/file-browser/${encodeURIComponent(fs.id)}`}>
                  <Button variant="outline" size="sm" data-testid={`button-browse-${fs.id}`}>
                    <FolderOpen className="mr-2 h-4 w-4" />
                    Browse
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
