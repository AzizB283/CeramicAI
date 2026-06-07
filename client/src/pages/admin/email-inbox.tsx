import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Inbox, Mail, Send, Paperclip, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmailThread {
  id: number;
  clientId: string;
  leadId: number | null;
  gmailThreadId: string;
  gmailMessageId: string;
  fromEmail: string | null;
  fromName: string | null;
  subject: string | null;
  bodyText: string | null;
  sourcePlatform: string | null; // "alibaba" | "indiamart" | "tradeindia" | "direct" | "website"
  language: string | null;
  generatedReply: string | null;
  sentReply: string | null;
  status: string; // "pending_approval" | "sent"
  receivedAt: string;
  sentAt: string | null;
}

// Per-platform badge tint. Falls back to a neutral grey for unknown sources.
const platformBadge: Record<string, string> = {
  alibaba: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-transparent",
  indiamart: "bg-blue-100 text-blue-700 hover:bg-blue-100 border-transparent",
  tradeindia: "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-transparent",
  direct: "bg-coral/10 text-coral-dark hover:bg-coral/10 border-transparent",
  website: "bg-violet-100 text-violet-700 hover:bg-violet-100 border-transparent",
};

function timeAgo(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.round(diffMs / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function snippet(text: string | null, max = 120) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}

function platformLabel(p: string | null) {
  if (!p) return "Direct";
  return p.replace(/\b\w/g, (c) => c.toUpperCase());
}

function fromLine(thread: EmailThread) {
  if (thread.fromName && thread.fromEmail) {
    return `${thread.fromName} <${thread.fromEmail}>`;
  }
  return thread.fromName || thread.fromEmail || "Unknown sender";
}

export default function AdminEmailInbox() {
  const { toast } = useToast();
  const { data: threads, isLoading } = useQuery<EmailThread[]>({
    queryKey: ["/api/admin/email/threads"],
  });

  const [selectedId, setSelectedId] = useState<number | null>(null);
  // The list row already carries every field, so we show the selected thread
  // straight from the loaded list rather than firing a second detail request.
  const selected = threads?.find((t) => t.id === selectedId) ?? null;

  // Editable draft, seeded from the selected thread. Once sent, we show the
  // sent body instead and lock editing.
  const [draft, setDraft] = useState("");
  const isSent = selected?.status === "sent";
  useEffect(() => {
    if (!selected) return;
    setDraft(selected.sentReply ?? selected.generatedReply ?? "");
  }, [selectedId, selected?.sentReply, selected?.generatedReply]);

  const sendMutation = useMutation({
    mutationFn: async (vars: { id: number; body: string }) => {
      const res = await apiRequest("POST", `/api/admin/email/threads/${vars.id}/send`, {
        body: vars.body,
      });
      return res.json() as Promise<EmailThread>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/email/threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leads"] });
      toast({ title: "Reply sent" });
    },
    onError: (err: Error) =>
      toast({ title: "Send failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Email Inbox</h1>
          <p className="text-muted-foreground">
            Buyer inquiries detected in your connected Gmail
          </p>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Email Inbox</h1>
        <p className="text-muted-foreground">
          Buyer inquiries detected in your connected Gmail
        </p>
      </div>

      {threads && threads.length > 0 ? (
        <div className="space-y-3">
          {threads.map((thread) => (
            <Card
              key={thread.id}
              role="button"
              tabIndex={0}
              data-testid={`card-email-${thread.id}`}
              className="cursor-pointer transition-colors hover:border-coral/40 hover:bg-coral/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-coral/40"
              onClick={() => setSelectedId(thread.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedId(thread.id);
                }
              }}
            >
              <CardContent className="pt-5">
                <div className="flex items-start justify-between gap-3">
                  <Badge
                    className={cn(
                      "capitalize",
                      platformBadge[thread.sourcePlatform ?? ""] ??
                        "bg-gray-100 text-gray-600 hover:bg-gray-100 border-transparent",
                    )}
                  >
                    {platformLabel(thread.sourcePlatform)}
                  </Badge>
                  <div className="flex shrink-0 items-center gap-2">
                    {thread.status === "sent" && (
                      <Badge className="border-transparent bg-green-100 text-green-700 hover:bg-green-100">
                        <CheckCircle2 className="mr-1 h-3 w-3" /> Sent
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {timeAgo(thread.receivedAt)}
                    </span>
                  </div>
                </div>
                <div className="mt-2 text-sm font-medium">
                  {thread.fromName || thread.fromEmail || "Unknown sender"}
                  {thread.fromName && thread.fromEmail && (
                    <span className="ml-1 font-normal text-muted-foreground">
                      {thread.fromEmail}
                    </span>
                  )}
                </div>
                <div className="mt-1 font-semibold">
                  {thread.subject || "(no subject)"}
                </div>
                {thread.bodyText && (
                  <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                    {snippet(thread.bodyText)}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Inbox className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="mb-2 font-semibold">No buyer emails yet</h3>
            <p className="text-muted-foreground">
              Connect Gmail in Integrations and they'll appear here.
            </p>
          </CardContent>
        </Card>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(o) => !o && setSelectedId(null)}
      >
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle>{selected.subject || "(no subject)"}</DialogTitle>
                <DialogDescription>
                  From {fromLine(selected)} · {timeAgo(selected.receivedAt)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 py-2">
                {/* Original email */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    Original email
                  </div>
                  <div className="space-y-1 text-sm">
                    <div>
                      <span className="text-muted-foreground">From: </span>
                      {fromLine(selected)}
                    </div>
                    <div>
                      <span className="text-muted-foreground">Subject: </span>
                      {selected.subject || "(no subject)"}
                    </div>
                  </div>
                  <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                    {selected.bodyText || "(no message body)"}
                  </div>
                </div>

                {/* Reply — editable until sent */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-semibold">
                      {isSent ? "Sent reply" : "Reply"}
                    </div>
                    {isSent && selected.sentAt && (
                      <span className="flex items-center gap-1 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Sent {timeAgo(selected.sentAt)}
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    readOnly={isSent}
                    rows={10}
                    className={cn("resize-y", isSent && "bg-muted/30")}
                    placeholder="No reply generated yet — write one here."
                  />

                  {!isSent && (
                    <div className="flex items-center justify-between gap-3 pt-1">
                      {/* Attach is the next slice — visible but disabled so the
                          UI shape is in place. */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled
                        title="Attachments coming soon"
                      >
                        <Paperclip className="mr-2 h-4 w-4" />
                        Attach
                      </Button>
                      <Button
                        type="button"
                        onClick={() => sendMutation.mutate({ id: selected.id, body: draft })}
                        disabled={sendMutation.isPending || !draft.trim() || !selected.fromEmail}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {sendMutation.isPending ? "Sending…" : "Send reply"}
                      </Button>
                    </div>
                  )}

                  {!isSent && !selected.fromEmail && (
                    <p className="text-xs text-destructive">
                      No sender address on this email — can't send a reply.
                    </p>
                  )}
                  {!isSent && (
                    <p className="text-xs text-muted-foreground">
                      Edit the draft above before sending. The reply goes to{" "}
                      {selected.fromEmail ?? "the buyer"} on your connected Gmail, in the same thread.
                    </p>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
