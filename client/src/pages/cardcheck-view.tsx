import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams, useLocation } from "wouter";
import { Loader2, ArrowLeft, User, FileText, Calendar, CheckCircle, XCircle, Clock } from "lucide-react";
import { Cardcheck, CardcheckDefinition, Worker, Contact } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { format } from "date-fns";
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
import { SignatureModal } from "@/components/esig/SignatureModal";
import { EsigView } from "@/components/esig/EsigView";

export default function CardcheckViewPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [signModalOpen, setSignModalOpen] = useState(false);

  const { data: cardcheck, isLoading, error } = useQuery<Cardcheck>({
    queryKey: ["/api/cardcheck", id],
    enabled: !!id,
  });

  const { data: definition } = useQuery<CardcheckDefinition>({
    queryKey: ["/api/cardcheck/definition", cardcheck?.cardcheckDefinitionId],
    enabled: !!cardcheck?.cardcheckDefinitionId,
  });

  const { data: worker } = useQuery<Worker>({
    queryKey: ["/api/workers", cardcheck?.workerId],
    enabled: !!cardcheck?.workerId,
  });

  const { data: contact } = useQuery<Contact>({
    queryKey: ["/api/contacts", worker?.contactId],
    enabled: !!worker?.contactId,
  });

  const handleSignSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/cardcheck", id] });
    queryClient.invalidateQueries({ queryKey: ["/api/workers", cardcheck?.workerId, "cardchecks"] });
  };

  const revokeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/cardcheck/${id}`, { status: "revoked" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cardcheck", id] });
      queryClient.invalidateQueries({ queryKey: ["/api/workers", cardcheck?.workerId, "cardchecks"] });
      toast({
        title: "Success",
        description: "Cardcheck has been revoked.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to revoke cardcheck.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("DELETE", `/api/cardcheck/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", cardcheck?.workerId, "cardchecks"] });
      toast({
        title: "Success",
        description: "Cardcheck deleted successfully.",
      });
      if (cardcheck?.workerId) {
        setLocation(`/workers/${cardcheck.workerId}/cardchecks`);
      } else {
        setLocation("/workers");
      }
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete cardcheck.",
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !cardcheck) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-destructive">Cardcheck not found.</p>
            <Link href="/workers">
              <Button variant="outline" className="mt-4">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Workers
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "signed":
        return <CheckCircle className="h-5 w-5 text-green-600" />;
      case "revoked":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "signed":
        return "default";
      case "revoked":
        return "destructive";
      default:
        return "secondary";
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            {cardcheck.workerId && (
              <Link href={`/workers/${cardcheck.workerId}/cardchecks`}>
                <Button variant="ghost" size="icon" data-testid="button-back">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
            )}
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="heading-cardcheck">
                Cardcheck
              </h1>
              <p className="text-muted-foreground text-sm">
                {definition?.name || "Loading..."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {getStatusIcon(cardcheck.status)}
            <Badge variant={getStatusBadgeVariant(cardcheck.status)} className="text-sm">
              {cardcheck.status}
            </Badge>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Worker
              </CardTitle>
            </CardHeader>
            <CardContent>
              {worker && contact ? (
                <div className="space-y-2">
                  <p className="font-medium" data-testid="text-worker-name">
                    {contact.displayName}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono">
                    [{worker.siriusId}]
                  </p>
                  <Link href={`/workers/${worker.id}`}>
                    <Button variant="outline" size="sm" className="mt-2">
                      View Worker
                    </Button>
                  </Link>
                </div>
              ) : (
                <p className="text-muted-foreground">Loading worker info...</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Definition
              </CardTitle>
            </CardHeader>
            <CardContent>
              {definition ? (
                <div className="space-y-2">
                  <p className="font-medium" data-testid="text-definition-name">
                    {definition.name}
                  </p>
                  <p className="text-sm text-muted-foreground font-mono">
                    [{definition.siriusId}]
                  </p>
                  {definition.description && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {definition.description}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">Loading definition info...</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Status Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Status</label>
                <p className="text-foreground capitalize" data-testid="text-status">
                  {cardcheck.status}
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium text-muted-foreground">Signed Date</label>
                <p className="text-foreground" data-testid="text-signed-date">
                  {cardcheck.signedDate 
                    ? format(new Date(cardcheck.signedDate), "MMMM d, yyyy 'at' h:mm a") 
                    : "Not signed"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {cardcheck.esigId ? (
          <EsigView esigId={cardcheck.esigId} isRevoked={cardcheck.status === "revoked"} />
        ) : (
          definition?.body && (
            <Card>
              <CardHeader>
                <CardTitle>Document Content</CardTitle>
              </CardHeader>
              <CardContent>
                <div 
                  className="prose prose-sm max-w-none dark:prose-invert"
                  dangerouslySetInnerHTML={{ __html: definition.body }}
                  data-testid="text-body"
                />
              </CardContent>
            </Card>
          )
        )}

        <Separator />

        <div className="flex items-center gap-2 flex-wrap">
          {cardcheck.status === "pending" && (
            <Button 
              onClick={() => setSignModalOpen(true)}
              data-testid="button-sign"
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              Sign Cardcheck
            </Button>
          )}
          
          {cardcheck.status === "signed" && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-revoke">
                  <XCircle className="h-4 w-4 mr-2" />
                  Revoke
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Revoke Cardcheck?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to revoke this cardcheck? This action can be undone by signing again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction 
                    onClick={() => revokeMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Revoke
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" className="text-destructive" data-testid="button-delete">
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Cardcheck?</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to delete this cardcheck? This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction 
                  onClick={() => deleteMutation.mutate()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {id && definition && (
        <SignatureModal
          open={signModalOpen}
          onOpenChange={setSignModalOpen}
          docType="cardcheck"
          docTitle={definition.name}
          docRender={definition.body || ""}
          entityId={id}
          onSuccess={handleSignSuccess}
        />
      )}
    </div>
  );
}
