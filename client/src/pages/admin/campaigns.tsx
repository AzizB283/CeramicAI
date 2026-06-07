import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Send, Plus, Users2, Mail, Loader2, FlaskConical, Flame, Eye, Trash2, Pause, Play } from "lucide-react";
import type { SegmentRule } from "@shared/types";

const BUYER_TYPES = ["retailer", "distributor", "architect", "builder", "export", "general"];

interface Segment {
  id: number;
  name: string;
  rule: SegmentRule;
  kind: string;
}
interface Campaign {
  id: number;
  name: string;
  status: "draft" | "scheduled" | "sending" | "paused" | "done";
  segmentId: number | null;
  aiPersonalize: boolean;
  stats: CampaignStats;
  createdAt: string;
}
interface CampaignStats {
  total?: number;
  queued?: number;
  sent?: number;
  opened?: number;
  replied?: number;
  hot?: number;
  sampleRequests?: number;
  failed?: number;
  unsubscribed?: number;
}
interface Catalogue {
  id: number;
  title: string;
}

const statusBadge: Record<Campaign["status"], string> = {
  draft: "bg-gray-100 text-gray-600",
  scheduled: "bg-blue-100 text-blue-700",
  sending: "bg-amber-100 text-amber-700",
  paused: "bg-orange-100 text-orange-700",
  done: "bg-green-100 text-green-700",
};

export default function AdminCampaigns() {
  const { data: campaigns, isLoading } = useQuery<Campaign[]>({ queryKey: ["/api/admin/campaigns"] });
  const { data: segments } = useQuery<Segment[]>({ queryKey: ["/api/admin/campaigns/segments"] });
  const [newCampaignOpen, setNewCampaignOpen] = useState(false);
  const [newSegmentOpen, setNewSegmentOpen] = useState(false);
  const [reportFor, setReportFor] = useState<Campaign | null>(null);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">
            Send personalized emails to a segment of your contacts via your connected Gmail
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setNewSegmentOpen(true)} data-testid="button-new-segment">
            <Users2 className="mr-2 h-4 w-4" /> New segment
          </Button>
          <Button onClick={() => setNewCampaignOpen(true)} data-testid="button-new-campaign">
            <Plus className="mr-2 h-4 w-4" /> New campaign
          </Button>
        </div>
      </div>

      {/* Segments */}
      <SegmentsCard segments={segments ?? []} />

      {/* Campaigns */}
      {isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-48 w-full" />
          </CardContent>
        </Card>
      ) : (campaigns?.length ?? 0) > 0 ? (
        <div className="grid gap-3">
          {campaigns!.map((c) => (
            <CampaignRow key={c.id} campaign={c} onReport={() => setReportFor(c)} />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Mail className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="mb-2 font-semibold">No campaigns yet</h3>
            <p className="mb-4 text-muted-foreground">
              Create a segment, then a campaign to start reaching your contacts.
            </p>
            <Button onClick={() => setNewCampaignOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New campaign
            </Button>
          </CardContent>
        </Card>
      )}

      <NewSegmentDialog open={newSegmentOpen} onClose={() => setNewSegmentOpen(false)} />
      <NewCampaignDialog
        open={newCampaignOpen}
        onClose={() => setNewCampaignOpen(false)}
        segments={segments ?? []}
      />
      <ReportDialog campaign={reportFor} onClose={() => setReportFor(null)} />
    </div>
  );
}

// ── Segments card ───────────────────────────────────────────────────────
function SegmentsCard({ segments }: { segments: Segment[] }) {
  const { toast } = useToast();
  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/campaigns/segments/${id}`),
    onSuccess: () => {
      toast({ title: "Segment deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/campaigns/segments"] });
    },
  });
  if (segments.length === 0) return null;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Segments</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {segments.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-sm"
          >
            <Users2 className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="font-medium">{s.name}</span>
            <span className="text-xs text-muted-foreground">{ruleSummary(s.rule)}</span>
            {s.kind === "manual" && (
              <button
                className="text-muted-foreground hover:text-red-600"
                onClick={() => del.mutate(s.id)}
                aria-label="Delete segment"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ruleSummary(rule: SegmentRule): string {
  const parts: string[] = [];
  if (rule.country?.length) parts.push(rule.country.join("/"));
  if (rule.buyerType?.length) parts.push(rule.buyerType.join("/"));
  if (rule.tags?.length) parts.push(`#${rule.tags.join(" #")}`);
  return parts.length ? parts.join(" · ") : "all contacts";
}

// ── Campaign row ────────────────────────────────────────────────────────
function CampaignRow({ campaign, onReport }: { campaign: Campaign; onReport: () => void }) {
  const { toast } = useToast();
  const s = campaign.stats ?? {};

  const send = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/campaigns/${campaign.id}/send`),
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Campaign started", description: `Sending to ${data.enrolled ?? 0} contacts.` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/campaigns"] });
    },
    onError: (err: Error) =>
      toast({ title: "Couldn't send", description: cleanErr(err.message), variant: "destructive" }),
  });
  const pause = useMutation({
    mutationFn: (action: "pause" | "resume") => apiRequest("POST", `/api/admin/campaigns/${campaign.id}/${action}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/campaigns"] }),
  });
  const del = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/campaigns/${campaign.id}`),
    onSuccess: () => {
      toast({ title: "Campaign deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/campaigns"] });
    },
  });

  return (
    <Card data-testid={`row-campaign-${campaign.id}`}>
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="min-w-[12rem]">
          <div className="flex items-center gap-2">
            <span className="font-semibold">{campaign.name}</span>
            <Badge className={`border-transparent capitalize ${statusBadge[campaign.status]}`}>
              {campaign.status}
            </Badge>
            {campaign.aiPersonalize && <Badge variant="outline">AI</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>{s.sent ?? 0} sent</span>
            <span className="inline-flex items-center gap-1">
              <Eye className="h-3 w-3" /> {s.opened ?? 0}
            </span>
            <span>{s.replied ?? 0} replied</span>
            <span className="inline-flex items-center gap-1 text-red-600">
              <FlaskConical className="h-3 w-3" /> {s.sampleRequests ?? 0} samples
            </span>
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Flame className="h-3 w-3" /> {s.hot ?? 0} hot
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onReport}>
            Report
          </Button>
          {(campaign.status === "draft" || campaign.status === "scheduled") && (
            <Button size="sm" onClick={() => send.mutate()} disabled={send.isPending} data-testid={`button-send-${campaign.id}`}>
              {send.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              Send
            </Button>
          )}
          {campaign.status === "sending" && (
            <Button size="sm" variant="outline" onClick={() => pause.mutate("pause")}>
              <Pause className="mr-2 h-4 w-4" /> Pause
            </Button>
          )}
          {campaign.status === "paused" && (
            <Button size="sm" onClick={() => pause.mutate("resume")}>
              <Play className="mr-2 h-4 w-4" /> Resume
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-red-600"
            onClick={() => del.mutate()}
            aria-label="Delete campaign"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function cleanErr(msg: string): string {
  // apiRequest throws "<status>: <body>"; surface just the server's message.
  const m = msg.match(/\d+:\s*(\{.*\})/);
  if (m) {
    try {
      return JSON.parse(m[1]).error ?? msg;
    } catch {
      /* fall through */
    }
  }
  return msg;
}

// ── New segment dialog ──────────────────────────────────────────────────
function NewSegmentDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [tags, setTags] = useState("");

  const rule: SegmentRule = useMemo(() => {
    const r: SegmentRule = {};
    const countries = country.split(",").map((c) => c.trim()).filter(Boolean);
    if (countries.length) r.country = countries;
    if (types.length) r.buyerType = types;
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    if (tagList.length) r.tags = tagList;
    return r;
  }, [country, types, tags]);

  const { data: preview } = useQuery<{ total: number; sendable: number }>({
    queryKey: [`/api/admin/campaigns/segments/preview`, JSON.stringify(rule)],
    queryFn: async () => {
      const res = await apiRequest("POST", "/api/admin/campaigns/segments/preview", { rule });
      return res.json();
    },
    enabled: open,
  });

  const save = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/campaigns/segments", { name: name.trim(), rule }),
    onSuccess: () => {
      toast({ title: "Segment saved" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/campaigns/segments"] });
      setName("");
      setCountry("");
      setTypes([]);
      setTags("");
      onClose();
    },
    onError: () => toast({ title: "Couldn't save segment", variant: "destructive" }),
  });

  const toggleType = (t: string) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New segment</DialogTitle>
          <DialogDescription>
            A saved audience filter. Opted-out and unsubscribed contacts are always excluded.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="seg-name">Name</Label>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Gulf distributors" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="seg-country">Countries (comma-separated)</Label>
            <Input id="seg-country" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="UAE, Saudi Arabia" />
          </div>
          <div className="grid gap-1.5">
            <Label>Buyer types</Label>
            <div className="flex flex-wrap gap-1.5">
              {BUYER_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={`rounded-full border px-3 py-1 text-sm capitalize ${
                    types.includes(t) ? "border-coral bg-coral text-white" : "bg-background"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="seg-tags">Tags (comma-separated, any match)</Label>
            <Input id="seg-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, gulf" />
          </div>
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <strong>{preview?.sendable ?? 0}</strong> sendable contacts match
            {preview && preview.total !== preview.sendable && (
              <span className="text-muted-foreground"> ({preview.total} total, {preview.total - preview.sendable} suppressed)</span>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !name.trim()} data-testid="button-save-segment">
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Save segment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── New campaign dialog ─────────────────────────────────────────────────
function NewCampaignDialog({
  open,
  onClose,
  segments,
}: {
  open: boolean;
  onClose: () => void;
  segments: Segment[];
}) {
  const { toast } = useToast();
  const { data: catalogues } = useQuery<Catalogue[]>({ queryKey: ["/api/admin/catalogues"], enabled: open });
  const [name, setName] = useState("");
  const [segmentId, setSegmentId] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(
    "Hi {{name}},\n\nWe're a ceramic tile exporter in Morbi and thought our latest collection might fit your range. You can view our catalogue here:\n\n{{catalogue}}\n\nHappy to send samples or a quote — just reply to this email.\n\nBest regards",
  );
  const [catalogueId, setCatalogueId] = useState<string>("");
  const [ai, setAi] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/campaigns", {
        name: name.trim(),
        segmentId: Number(segmentId),
        subject: subject.trim(),
        bodyTemplate: body,
        catalogueId: catalogueId ? Number(catalogueId) : null,
        aiPersonalize: ai,
      }),
    onSuccess: () => {
      toast({ title: "Campaign created", description: "Review it, then hit Send." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/campaigns"] });
      onClose();
      setName("");
      setSubject("");
      setSegmentId("");
      setCatalogueId("");
    },
    onError: (err: Error) => toast({ title: "Couldn't create", description: cleanErr(err.message), variant: "destructive" }),
  });

  const valid = name.trim() && segmentId && subject.trim() && body.trim();

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
          <DialogDescription>
            Use {"{{name}}"}, {"{{company}}"}, {"{{country}}"} and {"{{catalogue}}"} tokens — they're filled per contact.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-name">Campaign name</Label>
              <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="March GVT drop" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-segment">Segment</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger id="c-segment">
                  <SelectValue placeholder="Choose audience" />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-subject">Subject</Label>
            <Input id="c-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="New porcelain collection for {{country}}" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="c-body">Email body</Label>
            <Textarea id="c-body" value={body} onChange={(e) => setBody(e.target.value)} rows={9} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="c-cat">Catalogue (for {"{{catalogue}}"})</Label>
              <Select value={catalogueId} onValueChange={setCatalogueId}>
                <SelectTrigger id="c-cat">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {(catalogues ?? []).map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1">
              <Switch id="c-ai" checked={ai} onCheckedChange={setAi} />
              <Label htmlFor="c-ai" className="cursor-pointer">AI-personalize each email</Label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending || !valid} data-testid="button-create-campaign">
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Report dialog ───────────────────────────────────────────────────────
interface ReportData {
  campaign: Campaign;
  stats: CampaignStats;
  recipientCount: number;
}
function ReportDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const { data } = useQuery<ReportData>({
    queryKey: [`/api/admin/campaigns/${campaign?.id}`],
    enabled: !!campaign,
  });
  if (!campaign) return null;
  const s = data?.stats ?? campaign.stats ?? {};
  const metric = (label: string, value: number, accent?: string) => (
    <div className="rounded-md border p-3 text-center">
      <div className={`text-2xl font-bold ${accent ?? ""}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
  return (
    <Dialog open={!!campaign} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{campaign.name}</DialogTitle>
          <DialogDescription>Campaign performance</DialogDescription>
        </DialogHeader>
        {/* North-star metric headlined first */}
        <div className="grid grid-cols-3 gap-2 py-2">
          {metric("Sample requests", s.sampleRequests ?? 0, "text-red-600")}
          {metric("Hot replies", s.hot ?? 0, "text-amber-600")}
          {metric("Opened", s.opened ?? 0)}
          {metric("Sent", s.sent ?? 0)}
          {metric("Replied", s.replied ?? 0)}
          {metric("Unsubscribed", s.unsubscribed ?? 0)}
        </div>
        <p className="text-xs text-muted-foreground">
          A sample request auto-creates a priority lead and alerts the owner.
        </p>
      </DialogContent>
    </Dialog>
  );
}
