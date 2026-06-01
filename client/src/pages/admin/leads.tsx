import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Users, Globe2, AlertTriangle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";

type LeadStatus = "new" | "contacted" | "converted" | "lost";
type LeadPriority = "normal" | "high" | "priority";

interface CeramicLead {
  id: number;
  sessionId: string;
  channel: string | null;
  buyerType: string | null;
  buyerName: string | null;
  buyerPhone: string | null;
  buyerCompany: string | null;
  buyerCountry: string | null;
  buyerCity: string | null;
  productCategory: string | null;
  productSize: string | null;
  productFinish: string | null;
  quantity: string | null;
  incoterms: string | null;
  sampleRequested: boolean | null;
  isDistributorInquiry: boolean | null;
  priority: LeadPriority | null;
  status: LeadStatus | null;
  catalogSent: boolean | null;
  ownerNotified: boolean | null;
  createdAt: string;
  notes: string | null;
}

const STATUS_OPTIONS: LeadStatus[] = ["new", "contacted", "converted", "lost"];

const priorityBadge: Record<LeadPriority, string> = {
  priority: "bg-red-100 text-red-700 hover:bg-red-100 border-transparent",
  high: "bg-amber-100 text-amber-700 hover:bg-amber-100 border-transparent",
  normal: "bg-gray-100 text-gray-600 hover:bg-gray-100 border-transparent",
};

function formatProduct(lead: CeramicLead) {
  const parts = [lead.productCategory, lead.productSize, lead.productFinish].filter(
    Boolean,
  );
  return parts.length ? parts.join(" · ") : "—";
}

function formatLocation(lead: CeramicLead) {
  const parts = [lead.buyerCity, lead.buyerCountry].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function titleCase(s: string | null) {
  if (!s) return "—";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminLeads() {
  const { toast } = useToast();
  const { data: leads, isLoading } = useQuery<CeramicLead[]>({
    queryKey: ["/api/admin/leads"],
  });

  const [priorityOnly, setPriorityOnly] = useState(false);

  const visibleLeads = useMemo(() => {
    if (!leads) return [];
    return priorityOnly ? leads.filter((l) => l.priority === "priority") : leads;
  }, [leads, priorityOnly]);

  const priorityCount = leads?.filter((l) => l.priority === "priority").length ?? 0;

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: number; status: LeadStatus }) =>
      apiRequest("PATCH", `/api/admin/leads/${id}`, { status }),
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/admin/leads"] });
      const previous = queryClient.getQueryData<CeramicLead[]>([
        "/api/admin/leads",
      ]);
      queryClient.setQueryData<CeramicLead[]>(["/api/admin/leads"], (old) =>
        old?.map((l) => (l.id === id ? { ...l, status } : l)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["/api/admin/leads"], context.previous);
      }
      toast({ title: "Failed to update status", variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Lead status updated" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground">Buyer inquiries captured by the bot</p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-muted-foreground">Buyer inquiries captured by the bot</p>
        </div>
        {priorityCount > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm dark:border-red-900 dark:bg-red-950/40">
            <AlertTriangle className="h-4 w-4 text-red-600 shrink-0" />
            <Label htmlFor="priority-only" className="cursor-pointer">
              Priority only{" "}
              <span className="text-muted-foreground">({priorityCount})</span>
            </Label>
            <Switch
              id="priority-only"
              checked={priorityOnly}
              onCheckedChange={setPriorityOnly}
            />
          </div>
        )}
      </div>

      {visibleLeads.length > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>City / Country</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead className="w-36">Status</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleLeads.map((lead) => {
                    const priority = (lead.priority ?? "normal") as LeadPriority;
                    const status = (lead.status ?? "new") as LeadStatus;
                    const isPriority = priority === "priority";
                    return (
                      <TableRow
                        key={lead.id}
                        data-testid={`row-lead-${lead.id}`}
                        className={cn(
                          // Red left-edge ribbon for priority rows; subtle coral
                          // tint for distributor inquiries (often the same row,
                          // priority wins visually).
                          isPriority && "border-l-4 border-l-red-500 bg-red-50/40 dark:bg-red-950/20",
                          !isPriority && lead.isDistributorInquiry && "bg-coral/5",
                        )}
                      >
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            {lead.isDistributorInquiry && (
                              <Globe2 className="h-3.5 w-3.5 shrink-0 text-coral" />
                            )}
                            <div>
                              <div>{lead.buyerName || "Unknown buyer"}</div>
                              {lead.buyerCompany && (
                                <div className="text-xs text-muted-foreground">
                                  {lead.buyerCompany}
                                </div>
                              )}
                              {lead.buyerPhone && (
                                <a
                                  href={`https://wa.me/${lead.buyerPhone.replace(/[^0-9]/g, "")}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-coral-dark"
                                  onClick={(e) => e.stopPropagation()}
                                  data-testid={`link-phone-${lead.id}`}
                                >
                                  <Phone className="h-3 w-3" />
                                  {lead.buyerPhone}
                                </a>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>{titleCase(lead.buyerType)}</TableCell>
                        <TableCell className="max-w-[16rem]">
                          <span className="text-sm">{formatProduct(lead)}</span>
                        </TableCell>
                        <TableCell>{formatLocation(lead)}</TableCell>
                        <TableCell>{lead.quantity || "—"}</TableCell>
                        <TableCell>
                          <Badge className={cn("capitalize", priorityBadge[priority])}>
                            {priority}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={status}
                            onValueChange={(v) =>
                              updateStatus.mutate({
                                id: lead.id,
                                status: v as LeadStatus,
                              })
                            }
                          >
                            <SelectTrigger
                              className="h-8 capitalize"
                              data-testid={`select-status-${lead.id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((s) => (
                                <SelectItem key={s} value={s} className="capitalize">
                                  {s}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right text-sm text-muted-foreground">
                          {formatDate(lead.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-50" />
            {priorityOnly && (leads?.length ?? 0) > 0 ? (
              <>
                <h3 className="mb-2 font-semibold">No priority leads</h3>
                <p className="text-muted-foreground">
                  No distributor or exclusive-rights inquiries yet. Turn off the filter to see all
                  leads.
                </p>
              </>
            ) : (
              <>
                <h3 className="mb-2 font-semibold">No leads yet</h3>
                <p className="text-muted-foreground">
                  Buyer inquiries will appear here once people chat with CeramicBot.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
