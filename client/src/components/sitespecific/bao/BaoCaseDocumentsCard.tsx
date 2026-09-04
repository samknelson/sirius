import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";

export function BaoCaseDocumentsCard({ caseId }: { caseId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const key = ["/api/entity-files", "bao-case", caseId];
  const { data } = useQuery<{ files: Array<{ id: string; fileId: string; name: string }> }>({ queryKey: key });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData(); body.append("file", file);
      const response = await fetch(`/api/entity-files/bao-case/${caseId}`, { method: "POST", body, credentials: "include" });
      if (!response.ok) throw new Error("Upload failed");
      return response.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle>Documents</CardTitle><><input ref={input} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ""; }} /><Button onClick={() => input.current?.click()} disabled={upload.isPending}><FileUp className="mr-2 h-4 w-4" />Upload</Button></></CardHeader><CardContent>{(data?.files ?? []).length === 0 ? <p className="text-sm text-muted-foreground">No documents uploaded yet.</p> : <ul className="space-y-2">{data!.files.map((f) => <li key={f.id} className="flex items-center justify-between rounded border p-2"><span>{f.name}</span><Button asChild variant="ghost" size="sm"><a href={`/api/files/${f.fileId}/download`}><Download className="h-4 w-4" /></a></Button></li>)}</ul>}</CardContent></Card>;
}