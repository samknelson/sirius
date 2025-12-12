import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Settings2, RefreshCw, Droplets, RotateCcw, Save } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useState } from "react";
import { Input } from "@/components/ui/input";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link, useLocation } from "wouter";

interface FloodConfigDefinition {
  name: string;
  threshold: number;
  windowSeconds: number;
  isCustom: boolean;
  variableId: string | null;
}

export default function FloodEventsConfigPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<{ threshold: number; windowSeconds: number } | null>(null);

  const { data: definitions, isLoading, refetch } = useQuery<FloodConfigDefinition[]>({
    queryKey: ["/api/flood-config/definitions"],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ eventName, threshold, windowSeconds }: { eventName: string; threshold: number; windowSeconds: number }) => {
      await apiRequest("PUT", `/api/flood-config/${encodeURIComponent(eventName)}`, { threshold, windowSeconds });
    },
    onSuccess: (_, { eventName }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flood-config/definitions"] });
      setEditingRow(null);
      setEditValues(null);
      toast({
        title: "Config Updated",
        description: `Flood config for "${eventName}" has been updated.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update flood config",
        variant: "destructive",
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (eventName: string) => {
      await apiRequest("DELETE", `/api/flood-config/${encodeURIComponent(eventName)}`);
    },
    onSuccess: (_, eventName) => {
      queryClient.invalidateQueries({ queryKey: ["/api/flood-config/definitions"] });
      toast({
        title: "Config Reset",
        description: `Flood config for "${eventName}" has been reset to default.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to reset flood config",
        variant: "destructive",
      });
    },
  });

  const startEditing = (def: FloodConfigDefinition) => {
    setEditingRow(def.name);
    setEditValues({ threshold: def.threshold, windowSeconds: def.windowSeconds });
  };

  const cancelEditing = () => {
    setEditingRow(null);
    setEditValues(null);
  };

  const saveEditing = (eventName: string) => {
    if (!editValues) return;
    updateMutation.mutate({ eventName, ...editValues });
  };

  const formatWindow = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    return `${Math.floor(seconds / 3600)}h`;
  };

  return (
    <div className="container mx-auto py-6 px-4">
      <Card>
        <CardHeader className="flex flex-col gap-4">
          <div className="flex flex-row items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Droplets className="h-5 w-5" />
                Flood Control
              </CardTitle>
              <CardDescription>
                Configure rate limiting thresholds and time windows for flood events.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              data-testid="button-refresh-flood-config"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
          <Tabs value="config" className="w-full">
            <TabsList>
              <TabsTrigger value="events" asChild>
                <Link href="/admin/users/flood-events" data-testid="tab-flood-events">
                  Events
                </Link>
              </TabsTrigger>
              <TabsTrigger value="config" data-testid="tab-flood-config">
                Configuration
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : definitions && definitions.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event Type</TableHead>
                  <TableHead>Threshold</TableHead>
                  <TableHead>Window</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-[150px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {definitions.map((def) => (
                  <TableRow key={def.name} data-testid={`row-flood-config-${def.name}`}>
                    <TableCell>
                      <Badge variant="secondary">{def.name}</Badge>
                    </TableCell>
                    <TableCell>
                      {editingRow === def.name ? (
                        <Input
                          type="number"
                          min={1}
                          value={editValues?.threshold ?? def.threshold}
                          onChange={(e) => setEditValues(prev => ({ ...prev!, threshold: parseInt(e.target.value) || 1 }))}
                          className="w-24"
                          data-testid={`input-threshold-${def.name}`}
                        />
                      ) : (
                        <span className="font-mono">{def.threshold}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {editingRow === def.name ? (
                        <Input
                          type="number"
                          min={1}
                          value={editValues?.windowSeconds ?? def.windowSeconds}
                          onChange={(e) => setEditValues(prev => ({ ...prev!, windowSeconds: parseInt(e.target.value) || 1 }))}
                          className="w-24"
                          data-testid={`input-window-${def.name}`}
                        />
                      ) : (
                        <span className="font-mono" title={`${def.windowSeconds} seconds`}>
                          {formatWindow(def.windowSeconds)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {def.isCustom ? (
                        <Badge variant="default">Custom</Badge>
                      ) : (
                        <Badge variant="outline">Default</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {editingRow === def.name ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => saveEditing(def.name)}
                              disabled={updateMutation.isPending}
                              data-testid={`button-save-${def.name}`}
                            >
                              <Save className="h-4 w-4 mr-1" />
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelEditing}
                              disabled={updateMutation.isPending}
                              data-testid={`button-cancel-${def.name}`}
                            >
                              Cancel
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => startEditing(def)}
                              data-testid={`button-edit-${def.name}`}
                            >
                              <Settings2 className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                            {def.isCustom && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={resetMutation.isPending}
                                    data-testid={`button-reset-${def.name}`}
                                  >
                                    <RotateCcw className="h-4 w-4 mr-1" />
                                    Reset
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Reset to Default?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will remove the custom configuration for "{def.name}" and restore the default values.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid="button-cancel-reset">Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => resetMutation.mutate(def.name)}
                                      data-testid="button-confirm-reset"
                                    >
                                      Reset
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Droplets className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg font-medium">No flood events configured</p>
              <p className="text-sm">No flood event types have been registered in the system.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
