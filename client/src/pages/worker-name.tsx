import { Star, User, ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Worker, Contact } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import NameManagement from "@/components/worker/NameManagement";

export default function WorkerName() {
  const { id } = useParams<{ id: string }>();
  
  const { data: worker, isLoading, error } = useQuery<Worker>({
    queryKey: ["/api/workers", id],
    queryFn: async () => {
      const response = await fetch(`/api/workers/${id}`);
      if (!response.ok) {
        throw new Error("Worker not found");
      }
      return response.json();
    },
  });

  // Fetch contact for the worker
  const { data: contact } = useQuery<Contact>({
    queryKey: ["/api/contacts", worker?.contactId],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${worker?.contactId}`);
      if (!response.ok) {
        throw new Error("Contact not found");
      }
      return response.json();
    },
    enabled: !!worker?.contactId,
  });

  if (isLoading) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Star className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Worker Name</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardHeader>
              <Skeleton className="h-8 w-48" />
            </CardHeader>
            <CardContent className="space-y-4">
              <Skeleton className="h-32 w-full" />
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (error || !worker) {
    return (
      <div className="bg-background text-foreground min-h-screen">
        {/* Header */}
        <header className="bg-card border-b border-border">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                  <Star className="text-primary-foreground" size={16} />
                </div>
                <h1 className="text-xl font-semibold text-foreground">Sirius</h1>
                <span className="text-muted-foreground text-sm font-medium">Worker Name</span>
              </div>
              <div className="flex items-center space-x-4">
                <Link href="/workers">
                  <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                    <ArrowLeft size={16} className="mr-2" />
                    Back to Workers
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <User className="text-muted-foreground" size={32} />
              </div>
              <h3 className="text-lg font-medium text-foreground mb-2">Worker Not Found</h3>
              <p className="text-muted-foreground text-center">
                The worker you're looking for doesn't exist or has been removed.
              </p>
              <Link href="/workers">
                <Button className="mt-4" data-testid="button-return-to-workers">
                  Return to Workers
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  // Generate avatar background color based on worker ID
  const avatarColors = [
    "bg-primary/10 text-primary",
    "bg-accent/10 text-accent", 
    "bg-yellow-100 text-yellow-600",
    "bg-purple-100 text-purple-600",
    "bg-red-100 text-red-600",
  ];
  const avatarColor = avatarColors[worker.id.length % avatarColors.length];

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/* Header */}
      <header className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Star className="text-primary-foreground" size={16} />
              </div>
              <h1 className="text-xl font-semibold text-foreground" data-testid={`text-worker-name-${worker.id}`}>
                {contact?.displayName || 'Loading...'}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/workers">
                <Button variant="ghost" size="sm" data-testid="button-back-to-workers">
                  <ArrowLeft size={16} className="mr-2" />
                  Back to Workers
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-card border-b border-border">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center space-x-2 py-3">
            <Link href={`/workers/${worker.id}`}>
              <Button variant="outline" size="sm" data-testid="button-worker-details">
                Details
              </Button>
            </Link>
            <Button variant="default" size="sm" data-testid="button-worker-name">
              Name
            </Button>
            <Link href={`/workers/${worker.id}/email`}>
              <Button variant="outline" size="sm" data-testid="button-worker-email">
                Email
              </Button>
            </Link>
            <Link href={`/workers/${worker.id}/ids`}>
              <Button variant="outline" size="sm" data-testid="button-worker-ids">
                IDs
              </Button>
            </Link>
            <Link href={`/workers/${worker.id}/addresses`}>
              <Button variant="outline" size="sm" data-testid="button-worker-addresses">
                Addresses
              </Button>
            </Link>
            <Link href={`/workers/${worker.id}/phone-numbers`}>
              <Button variant="outline" size="sm" data-testid="button-worker-phone-numbers">
                Phone Numbers
              </Button>
            </Link>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent>
            <NameManagement workerId={worker.id} contactId={worker.contactId} />
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
