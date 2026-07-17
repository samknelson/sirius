import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileText, Plus, Search, Loader2 } from "lucide-react";
import type { Contract } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageTitle } from "@/contexts/PageTitleContext";

export default function ContractsListPage() {
  usePageTitle("Contracts");
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const { data: contracts, isLoading } = useQuery<Contract[]>({
    queryKey: ["/api/contracts"],
  });

  const filtered = (contracts ?? []).filter((c) =>
    c.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const created: Contract = await apiRequest("POST", "/api/contracts", { name });
      await queryClient.invalidateQueries({ queryKey: ["/api/contracts"] });
      toast({ title: "Contract created", description: `"${created.name}" was created.` });
      setCreateOpen(false);
      setNewName("");
      navigate(`/contract/${created.id}`);
    } catch (error) {
      toast({
        title: "Failed to create contract",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground" data-testid="text-contracts-title">
            Contracts
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage collective bargaining agreements, their articles, and sections.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-contract">
              <Plus size={16} className="mr-2" />
              New Contract
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New Contract</DialogTitle>
              <DialogDescription>Give the contract a name to get started.</DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-2">
              <Label htmlFor="contract-name">Name</Label>
              <Input
                id="contract-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Master Agreement 2026"
                data-testid="input-contract-name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                }}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
                data-testid="button-cancel-create-contract"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!newName.trim() || creating}
                data-testid="button-confirm-create-contract"
              >
                {creating && <Loader2 size={16} className="mr-2 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="relative max-w-sm">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter contracts..."
          className="pl-9"
          data-testid="input-filter-contracts"
        />
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <FileText className="text-muted-foreground" size={32} />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-1">No contracts found</h3>
            <p className="text-muted-foreground text-center text-sm">
              {search.trim()
                ? "No contracts match your filter."
                : "Create your first contract to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((contract) => (
            <Link key={contract.id} href={`/contract/${contract.id}`}>
              <Card
                className="cursor-pointer hover-elevate active-elevate-2 h-full"
                data-testid={`card-contract-${contract.id}`}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileText size={18} className="text-primary shrink-0" />
                    <span data-testid={`text-contract-name-${contract.id}`}>{contract.name}</span>
                  </CardTitle>
                  <CardDescription>Open to manage articles and sections</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
