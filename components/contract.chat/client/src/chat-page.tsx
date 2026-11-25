import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowUp, BookOpen, Check, FileText, Loader2, MessageSquareText, RotateCcw, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { ChatContext } from "../../shared/experience";
import { providerWindow } from "../../shared/experience";
import type { ContractChatAnswer, ContractChatCatalogEntry } from "../../shared/types";
import {
  clearAllFeatureHistory,
  clearHistoryKey,
  clearObsoleteContextHistory,
  effectiveIdentity,
  historyKey,
  historyStorageFailed,
  isValidAnswer,
  providerHistory,
  readHistory,
  subscribeToHistoryClear,
  writeHistory,
  type DisplayMessage,
} from "./history";

const GENERIC_CONTEXT_ERROR = "The agreement library could not be checked. Retry before continuing.";
const GENERIC_ASK_ERROR = "That request could not be completed. You can choose to try again.";
const CONTRACT_LIMIT = 4000;

type ContextState =
  | { status: "loading" }
  | { status: "ready"; value: ChatContext }
  | { status: "error"; message: string };

function isChatContext(value: unknown): value is ChatContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as ChatContext;
  return typeof candidate.context === "string" &&
    !!candidate.context &&
    typeof candidate.providerName === "string" &&
    typeof candidate.external === "boolean" &&
    Array.isArray(candidate.contracts) &&
    candidate.contracts.every((contract: ContractChatCatalogEntry) =>
      contract && typeof contract.id === "string" && typeof contract.name === "string" &&
      ["current", "expired", "side_document"].includes(contract.status) &&
      (contract.notice === null || typeof contract.notice === "string") &&
      (contract.externalRef === null || typeof contract.externalRef === "string") &&
      (contract.termEnd === null || typeof contract.termEnd === "string") &&
      typeof contract.version === "number" && Number.isFinite(contract.version) &&
      Array.isArray(contract.documents) &&
      contract.documents.every((document) =>
        !!document && typeof document.id === "string" && typeof document.name === "string"));
}

async function responseError(response: Response): Promise<{ code: string; message: string }> {
  try {
    const value = await response.json();
    if (value && typeof value.code === "string" && typeof value.message === "string") {
      return { code: value.code, message: value.message };
    }
  } catch {
    // Do not display raw response text.
  }
  return { code: "unavailable", message: response.status === 401 || response.status === 403
    ? "You no longer have access to this feature."
    : GENERIC_ASK_ERROR };
}

function contractStatus(status: ContractChatCatalogEntry["status"]): string {
  return status === "current" ? "Current" : status === "expired" ? "Expired" : "Reference document";
}

function AnswerCard({ answer }: { answer: ContractChatAnswer }) {
  const status = answer.status;
  const outcome = status === "ok" ? "Answer" :
    status === "truncated" ? "Partial answer" :
    status === "refusal" ? "Outside the agreement" :
    status === "timeout" ? "Timed out" :
    status === "client_closed" ? "Interrupted" : "Could not answer";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
          status === "ok" ? "bg-emerald-100 text-emerald-900" :
          status === "truncated" ? "bg-amber-100 text-amber-950" :
          "bg-slate-200 text-slate-800"
        }`}>
          {status === "ok" ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {outcome}
        </span>
        <span className="text-xs text-muted-foreground">{answer.contractName} · {contractStatus(answer.contractStatus)}</span>
      </div>
      {answer.answer && <p className="whitespace-pre-wrap leading-7 text-foreground">{answer.answer}</p>}
      {answer.error?.message && <p className="text-sm text-muted-foreground">{answer.error.message}</p>}
      {answer.notice && (
        <div className="rounded-lg border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">
          {answer.notice}
        </div>
      )}
      {!!answer.citations.length && (
        <section aria-label="Agreement references" className="space-y-2 border-t border-border/80 pt-3">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" /> Agreement references
          </p>
          <div className="space-y-2">
            {answer.citations.map((citation, index) => (
              <blockquote key={`${citation.document}-${citation.page}-${index}`} className="rounded-lg bg-background/80 px-4 py-3">
                <p className="text-sm leading-6 text-foreground">“{citation.quote}”</p>
                <footer className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" />
                  <span>{citation.document}</span>
                  <span>·</span>
                  <span>p. {citation.page}{citation.endPage > citation.page ? `–${citation.endPage}` : ""}</span>
                  {citation.article && <><span>·</span><span>Article {citation.article}</span></>}
                  {citation.section && <><span>·</span><span>Section {citation.section}</span></>}
                </footer>
              </blockquote>
            ))}
          </div>
        </section>
      )}
      {answer.likelyGrievance && (
        <p className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-3 text-sm leading-6 text-slate-800">
          This may need a conversation with your union representative. The agreement and your circumstances matter.
        </p>
      )}
    </div>
  );
}

function LoadingLibrary() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-10 md:px-8" aria-label="Loading agreements">
      <div className="h-4 w-28 animate-pulse rounded bg-muted" />
      <div className="h-12 w-2/3 animate-pulse rounded bg-muted" />
      <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />
      <div className="h-64 animate-pulse rounded-2xl bg-muted/70" />
    </div>
  );
}

export default function ContractChatPage() {
  usePageTitle("Agreement guide");
  const { user, authReady, isAuthenticated, masquerade } = useAuth();
  const identity = authReady && isAuthenticated && user
    ? effectiveIdentity(String(user.id), masquerade.isMasquerading, masquerade.originalUser?.id)
    : "";
  const [contextState, setContextState] = useState<ContextState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [identityState, setIdentityState] = useState(identity);
  const [contextEpoch, setContextEpoch] = useState(0);
  const [contextBusy, setContextBusy] = useState(false);
  const [askFailure, setAskFailure] = useState("");
  const [catalogReloadRequired, setCatalogReloadRequired] = useState(false);
  // Gate output in the same render that observes an account switch.
  const identityChanged = identityState !== identity;
  const usableState = identityChanged || !authReady || !isAuthenticated
    ? null
    : contextState.status === "ready" ? contextState.value : null;
  const selectedContract = usableState?.contracts.find((contract) => contract.id === selectedId) ?? null;
  const activeKey = usableState && selectedContract && identity
    ? historyKey(identity, usableState.context, selectedContract.id)
    : "";
  const requestRef = useRef(0);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const contextRef = useRef<ChatContext | null>(null);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const focusDeferredRef = useRef(false);

  const isCurrentAsk = (ticket: number, identityAtStart: string, contextAtStart: string, contractId: string) =>
    mountedRef.current &&
    ticket === requestRef.current &&
    identityRef.current === identityAtStart &&
    contextRef.current?.context === contextAtStart &&
    selectedIdRef.current === contractId;

  const applyIdentityReset = useCallback(() => {
    requestRef.current++;
    busyRef.current = false;
    setPending(false);
    setQuestion("");
    setMessages([]);
    selectedIdRef.current = "";
    setSelectedId("");
    setAskFailure("");
    setStorageWarning(false);
    setIdentityState(identityRef.current);
    contextRef.current = null;
    setContextState({ status: "loading" });
  }, []);

  const fetchContext = useCallback(async (mode: "initial" | "focus" | "retry") => {
    if (!identityRef.current || !authReady || !isAuthenticated) return;
    if (mode === "focus" && busyRef.current) {
      focusDeferredRef.current = true;
      return;
    }
    if (mode === "focus") focusDeferredRef.current = false;
    const identityAtStart = identityRef.current;
    const ticket = ++requestRef.current;
    if (mode !== "initial") {
      setContextBusy(true);
      // Hide the transcript while verifying the session/provider scope.
      if (busyRef.current && activeKeyRef.current) {
        const saved = readHistory(activeKeyRef.current);
        if (saved && saved.length && saved[saved.length - 1].role === "user") {
          saved.pop();
          if (!writeHistory(activeKeyRef.current, saved)) setStorageWarning(true);
        }
      }
      setMessages([]);
      busyRef.current = false;
      setPending(false);
      setContextState({ status: "loading" });
    }
    try {
      const response = await fetch("/api/contract-chat/context", {
        credentials: "include",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!mountedRef.current || ticket !== requestRef.current || identityRef.current !== identityAtStart) return;
      if (response.status === 401 || response.status === 403) {
        clearAllFeatureHistory();
        requestRef.current++;
        setMessages([]);
        selectedIdRef.current = "";
        setSelectedId("");
        setContextState({ status: "error", message: "Your access has changed. Sign in again or contact your union administrator." });
        return;
      }
      if (!response.ok) {
        const error = await responseError(response);
        if (!mountedRef.current || ticket !== requestRef.current || identityRef.current !== identityAtStart) return;
        throw new Error(error.message || GENERIC_CONTEXT_ERROR);
      }
      const value: unknown = await response.json();
      if (!isChatContext(value)) throw new Error(GENERIC_CONTEXT_ERROR);
      if (!mountedRef.current || ticket !== requestRef.current || identityRef.current !== identityAtStart) return;
      const prior = contextRef.current;
      if (prior?.context !== value.context) {
        setMessages([]);
        selectedIdRef.current = "";
        setSelectedId("");
        setAskFailure("");
        setQuestion("");
        setContextEpoch((epoch) => epoch + 1);
        clearObsoleteContextHistory(identityAtStart, value.context);
      }
      contextRef.current = value;
      setContextState({ status: "ready", value });
      if (mode === "retry") setCatalogReloadRequired(false);
      if (prior?.context === value.context && selectedIdRef.current && value.contracts.some((entry) => entry.id === selectedIdRef.current)) {
        setSelectedId(selectedIdRef.current);
      } else if (prior?.context === value.context && selectedIdRef.current) {
        setSelectedId("");
        selectedIdRef.current = "";
      }
    } catch (error) {
      if (!mountedRef.current || ticket !== requestRef.current || identityRef.current !== identityAtStart) return;
      setMessages([]);
      selectedIdRef.current = "";
      setSelectedId("");
      contextRef.current = null;
      setContextState({ status: "error", message: error instanceof Error ? error.message : GENERIC_CONTEXT_ERROR });
    } finally {
      if (mountedRef.current && ticket === requestRef.current) setContextBusy(false);
    }
  }, [authReady, isAuthenticated]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current++;
      busyRef.current = false;
    };
  }, []);

  useEffect(() => subscribeToHistoryClear(() => {
    requestRef.current++;
    busyRef.current = false;
    setPending(false);
    setQuestion("");
    setMessages([]);
    selectedIdRef.current = "";
    setSelectedId("");
    setAskFailure("");
    setStorageWarning(false);
    contextRef.current = null;
    setContextState({ status: "loading" });
  }), []);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated || !identity) {
      applyIdentityReset();
      return;
    }
    if (identityState !== identity) {
      applyIdentityReset();
      setIdentityState(identity);
    }
  }, [applyIdentityReset, authReady, identity, identityState, isAuthenticated]);

  useEffect(() => {
    if (!authReady || !isAuthenticated || !identity || identityState !== identity) return;
    void fetchContext("initial");
  }, [authReady, fetchContext, identity, identityState, isAuthenticated]);

  useEffect(() => {
    if (!authReady || !isAuthenticated) return;
    const onFocus = () => {
      if (busyRef.current) {
        focusDeferredRef.current = true;
        return;
      }
      void fetchContext("focus");
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [authReady, fetchContext, isAuthenticated]);

  useEffect(() => {
    if (!activeKey || !selectedContract) {
      setMessages([]);
      return;
    }
    const restored = readHistory(activeKey);
    if (restored === null) {
      setStorageWarning(true);
      setMessages([]);
      return;
    }
    setMessages(restored);
    setStorageWarning(historyStorageFailed(activeKey));
  }, [activeKey, selectedContract, contextEpoch]);

  const persistMessages = useCallback((next: DisplayMessage[]) => {
    setMessages(next);
    if (!activeKey || !writeHistory(activeKey, next)) setStorageWarning(true);
  }, [activeKey]);

  const selectContract = (id: string) => {
    if (id === selectedId) return;
    const canceledPendingAsk = busyRef.current;
    requestRef.current++;
    busyRef.current = false;
    setPending(false);
    setAskFailure("");
    setQuestion("");
    setMessages([]);
    selectedIdRef.current = id;
    setSelectedId(id);
    if (focusDeferredRef.current) {
      focusDeferredRef.current = false;
      void fetchContext("focus");
    } else if (canceledPendingAsk) {
      focusDeferredRef.current = false;
    }
  };

  const deselectContract = () => {
    if (!selectedIdRef.current) return;
    requestRef.current++;
    busyRef.current = false;
    setPending(false);
    setAskFailure("");
    setQuestion("");
    setMessages([]);
    selectedIdRef.current = "";
    setSelectedId("");
    if (focusDeferredRef.current) {
      focusDeferredRef.current = false;
      void fetchContext("focus");
    }
  };

  const clearConversation = () => {
    if (!activeKey) return;
    const canceledPendingAsk = busyRef.current;
    requestRef.current++;
    busyRef.current = false;
    setPending(false);
    clearHistoryKey(activeKey);
    setMessages([]);
    setQuestion("");
    setAskFailure("");
    setStorageWarning(historyStorageFailed(activeKey));
    if (canceledPendingAsk && focusDeferredRef.current) {
      focusDeferredRef.current = false;
      void fetchContext("focus");
    }
  };

  const canAsk = !!selectedContract && !!usableState && !pending && question.trim().length > 0 &&
    question.length <= CONTRACT_LIMIT && !contextBusy && !catalogReloadRequired;

  const sendQuestion = async () => {
    const prompt = question.trim();
    const chatContext = contextRef.current;
    const currentContract = selectedContract;
    if (!prompt || prompt.length > CONTRACT_LIMIT || !chatContext || !currentContract ||
        busyRef.current || contextBusy || catalogReloadRequired || identityRef.current !== identity) return;
    busyRef.current = true;
    const ticket = ++requestRef.current;
    const identityAtStart = identity;
    const contextAtStart = chatContext.context;
    const contractAtStart = currentContract.id;
    const transcript = messages;
    const userMessage: DisplayMessage = { role: "user", content: prompt };
    const withQuestion = [...transcript, userMessage];
    persistMessages(withQuestion);
    setQuestion("");
    setPending(true);
    setAskFailure("");
    const boundedHistory = providerWindow(providerHistory(transcript), prompt);
    try {
      const response = await fetch("/api/contract-chat/ask", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ context: contextAtStart, contractId: contractAtStart, messages: boundedHistory }),
      });
      if (!isCurrentAsk(ticket, identityAtStart, contextAtStart, contractAtStart)) return;
      if (response.status === 401 || response.status === 403) {
        clearAllFeatureHistory();
        setMessages([]);
        selectedIdRef.current = "";
        setSelectedId("");
        contextRef.current = null;
        setContextState({ status: "error", message: "Your access has changed. Sign in again or contact your union administrator." });
        return;
      }
      if (!response.ok) {
        const error = await responseError(response);
        if (!isCurrentAsk(ticket, identityAtStart, contextAtStart, contractAtStart)) return;
        const failed = [...withQuestion, { role: "assistant" as const, content: error.message || GENERIC_ASK_ERROR, outcome: error.code }];
        persistMessages(failed);
        setAskFailure("This attempt did not produce an answer. Nothing was automatically resubmitted.");
        if (error.code === "context_changed" || error.code === "contract_unavailable") {
          setCatalogReloadRequired(true);
        }
        return;
      }
      const answer = await response.json() as ContractChatAnswer;
      if (!isCurrentAsk(ticket, identityAtStart, contextAtStart, contractAtStart)) return;
      if (!isValidAnswer(answer) || answer.contractId !== contractAtStart) {
        throw new Error(GENERIC_ASK_ERROR);
      }
      const assistant: DisplayMessage = {
        role: "assistant",
        content: answer.answer,
        answer,
        outcome: answer.status,
      };
      persistMessages([...withQuestion, assistant]);
      if (!["ok", "truncated"].includes(answer.status)) {
        setAskFailure("This attempt is complete. You may explicitly submit another question.");
      }
    } catch {
      if (!isCurrentAsk(ticket, identityAtStart, contextAtStart, contractAtStart)) return;
      persistMessages([...withQuestion, {
        role: "assistant",
        content: GENERIC_ASK_ERROR,
        outcome: "unavailable",
      }]);
      setAskFailure("The attempt ended without an answer. It was not retried; submit again only if you choose.");
    } finally {
      if (mountedRef.current && ticket === requestRef.current) {
        busyRef.current = false;
        setPending(false);
        if (focusDeferredRef.current) {
          focusDeferredRef.current = false;
          void fetchContext("focus");
        }
      }
    }
  };

  const catalog = usableState?.contracts ?? [];
  const selectedDocumentCount = selectedContract?.documents.length ?? 0;
  const transcriptLabel = useMemo(() => selectedContract ? `Conversation about ${selectedContract.name}` : "Choose an agreement", [selectedContract]);

  if (!authReady || contextState.status === "loading" || identityChanged) return <LoadingLibrary />;

  return (
      <main className="min-h-[calc(100dvh-4rem)] bg-muted/30">
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-7 md:px-8 md:pt-10">
        <header className="mb-7 flex flex-col justify-between gap-5 border-b border-border/80 pb-6 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              <span className="h-2 w-2 rounded-full bg-primary" /> Sirius · Agreement guide
            </p>
            <h1 className="font-display text-3xl font-semibold tracking-tight text-foreground md:text-[2.65rem]">
              Know what the agreement says.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">
              Ask a question in plain language. Answers point back to the agreement; they are not a replacement for reading it or getting union advice.
            </p>
          </div>
          {usableState && (
            <div className="flex items-center gap-3 self-start rounded-xl border border-border bg-background/75 px-4 py-3 md:self-auto">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="h-4 w-4" /></span>
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-foreground">{usableState.providerName}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{usableState.external ? "External service" : "Union service"}</span>
              </span>
            </div>
          )}
        </header>

        {contextState.status === "error" && (
          <Alert variant="destructive" role="alert" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              <span>{contextState.message || GENERIC_CONTEXT_ERROR}</span>
              <Button type="button" variant="outline" size="sm" disabled={contextBusy} onClick={() => void fetchContext("retry")}>
                <RotateCcw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {usableState && (
          <>
            {usableState.external && (
              <div className="mb-5 flex gap-3 rounded-xl border border-sky-300/70 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  The full conversation context you submit is sent to {usableState.providerName}, an external service.
                  The provider applies its own retention policy; clearing this chat in Sirius does not erase copies held by the provider.
                  Review your union’s privacy guidance before sharing personal details.
                </p>
              </div>
            )}
            <section className="grid gap-5 lg:grid-cols-[minmax(15rem,0.78fr)_minmax(0,1.7fr)]">
              <Card className="h-fit overflow-hidden border-border/80 bg-background shadow-sm">
                <div className="border-b border-border/80 px-5 py-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Agreement library</p>
                  <h2 className="mt-2 font-display text-xl font-semibold">Choose a source</h2>
                  <p className="mt-1 text-sm leading-5 text-muted-foreground">Select the agreement you want to ask about.</p>
                </div>
                {catalog.length ? (
                  <div className="space-y-2 p-3" role="radiogroup" aria-label="Select agreement">
                    {catalog.map((contract) => {
                      const selected = contract.id === selectedId;
                      return (
                        <button key={contract.id} type="button" role="radio" aria-checked={selected}
                          onClick={() => selectContract(contract.id)}
                          className={`w-full rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            selected ? "border-primary/50 bg-primary/[0.07]" : "border-transparent hover:border-border hover:bg-muted/50"
                          }`}>
                          <span className="flex items-start justify-between gap-3">
                            <span className="min-w-0">
                              <span className="block font-medium leading-5 text-foreground">{contract.name}</span>
                              <span className="mt-1.5 block text-xs text-muted-foreground">{contractStatus(contract.status)}{contract.termEnd ? ` · through ${contract.termEnd}` : ""}</span>
                            </span>
                            {selected && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                          </span>
                          {contract.notice && <span className="mt-2 block text-xs leading-5 text-amber-900">{contract.notice}</span>}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-5 py-8 text-center">
                    <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-muted text-muted-foreground"><BookOpen className="h-5 w-5" /></span>
                    <p className="mt-3 font-medium">No agreements are available</p>
                    <p className="mt-1 text-sm leading-5 text-muted-foreground">Ask your union administrator to check the agreement library.</p>
                  </div>
                )}
                <div className="border-t border-border/80 bg-muted/25 px-5 py-4">
                  <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground"><FileText className="h-3.5 w-3.5" /> {selectedDocumentCount} source {selectedDocumentCount === 1 ? "document" : "documents"}</p>
                </div>
              </Card>

              <Card className="flex min-h-[35rem] flex-col overflow-hidden border-border/80 bg-background shadow-sm">
                <div className="flex items-center justify-between gap-4 border-b border-border/80 px-5 py-4">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sirius chat</p>
                    <h2 className="mt-1 truncate font-display text-lg font-semibold">{transcriptLabel}</h2>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {selectedContract && (
                      <Button type="button" variant="outline" size="sm" onClick={deselectContract}>
                        Change agreement
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" disabled={!selectedContract || !messages.length}
                      onClick={clearConversation} aria-label="Start a new conversation">
                      <Trash2 className="mr-2 h-4 w-4" /><span className="hidden sm:inline">{messages.length ? "New conversation" : "Clear conversation"}</span>
                    </Button>
                  </div>
                </div>

                {!selectedContract ? (
                  <div className="grid flex-1 place-items-center px-6 py-12 text-center">
                    <div className="max-w-sm">
                      <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary"><MessageSquareText className="h-6 w-6" /></span>
                      <h3 className="mt-4 font-display text-xl font-semibold">Start with an agreement</h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">Choose one from the library to begin. We’ll keep the conversation scoped to that source.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-primary/[0.035] px-5 py-3">
                      <p className="text-sm text-foreground">
                        <span className="font-semibold">Currently selected:</span> {selectedContract.name}
                        <span className="ml-2 text-xs text-muted-foreground">· {contractStatus(selectedContract.status)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">Answers are scoped to this agreement.</p>
                    </div>
                    {catalogReloadRequired && (
                      <Alert variant="destructive" role="alert" className="mx-4 mt-4 md:mx-5">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                          <span>The agreement context changed or this source is unavailable. Reload the agreement library before asking again.</span>
                          <Button type="button" variant="outline" size="sm" disabled={contextBusy} onClick={() => void fetchContext("retry")}>
                            <RotateCcw className="mr-2 h-4 w-4" /> Reload agreements
                          </Button>
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="flex-1 space-y-5 overflow-y-auto px-4 py-5 md:px-6" aria-live="polite" aria-label="Chat transcript">
                      {!messages.length && !pending && (
                        <div className="mx-auto max-w-lg py-10 text-center">
                          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles className="h-5 w-5" /></span>
                          <p className="mt-4 font-medium">What would you like to understand?</p>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">Try asking about hours, leave, overtime, or a specific article. Add only the details needed to explain your question.</p>
                        </div>
                      )}
                      {messages.map((message, index) => (
                        <article key={`${index}-${message.role}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                          <div className={message.role === "user"
                            ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground md:max-w-[78%]"
                            : "w-full max-w-[96%] rounded-2xl rounded-bl-md bg-muted/55 px-4 py-4 md:max-w-[88%]"}>
                            {message.role === "user"
                              ? <p className="whitespace-pre-wrap">{message.content}</p>
                              : message.answer
                                ? <AnswerCard answer={message.answer} />
                                : <div className="space-y-2">
                                    <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-800">{message.outcome === "timeout" ? "Timed out" : "Unavailable"}</span>
                                    <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{message.content}</p>
                                  </div>}
                          </div>
                        </article>
                      ))}
                      {pending && (
                        <div className="flex justify-start" aria-label="Answer pending">
                          <div className="flex items-center gap-3 rounded-2xl rounded-bl-md bg-muted/55 px-4 py-4 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" /> Checking the agreement…
                          </div>
                        </div>
                      )}
                    </div>
                    {askFailure && <p role="status" className="px-5 pb-2 text-xs text-muted-foreground">{askFailure}</p>}
                    {storageWarning && (
                      <p role="status" className="px-5 pb-2 text-xs text-amber-800">
                        This session can’t save history in this browser. Changes remain in page memory only.
                        Older saved history may reappear after refresh, including if clearing could not be saved.
                      </p>
                    )}
                    <form className="border-t border-border/80 bg-background p-4 md:p-5" onSubmit={(event) => { event.preventDefault(); void sendQuestion(); }}>
                      <label htmlFor="contract-chat-question" className="sr-only">Ask about this agreement</label>
                      <div className="rounded-2xl border border-border bg-background p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10">
                        <textarea id="contract-chat-question" value={question} maxLength={CONTRACT_LIMIT}
                          onChange={(event) => setQuestion(event.target.value)}
                          onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendQuestion(); } }}
                          placeholder="Ask a question about this agreement…" rows={3} disabled={pending}
                          className="max-h-36 min-h-[4.25rem] w-full resize-y bg-transparent px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground/75 disabled:opacity-60" />
                        <div className="flex items-center justify-between gap-3 px-2 pb-1">
                          <span className="text-xs text-muted-foreground">{question.length.toLocaleString()} / {CONTRACT_LIMIT.toLocaleString()} · Enter to send</span>
                          <Button type="submit" size="sm" disabled={!canAsk} className="rounded-xl">
                            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArrowUp className="mr-2 h-4 w-4" />}
                            Ask
                          </Button>
                        </div>
                      </div>
                      <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-muted-foreground">
                        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        This guide can miss context. Confirm important decisions in the agreement or with your union representative.
                      </p>
                    </form>
                  </>
                )}
              </Card>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
