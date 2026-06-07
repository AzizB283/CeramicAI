import { useMemo, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Upload,
  Plus,
  Phone,
  Mail,
  MoreHorizontal,
  Ban,
  CheckCircle2,
  Trash2,
  Loader2,
  FileSpreadsheet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CsvPreset, InputContactDraft } from "@shared/types";

interface Contact {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  country: string | null;
  city: string | null;
  buyerType: string | null;
  source: string;
  tags: string[];
  optedOut: boolean;
  leadId: number | null;
  createdAt: string;
}

const BUYER_TYPES = ["retailer", "distributor", "architect", "builder", "export", "general"];
const SOURCE_LABELS: Record<string, string> = {
  manual: "Manual",
  lead: "From lead",
  csv: "CSV",
  tradeshow: "Trade show",
  indiamart: "IndiaMART",
  alibaba: "Alibaba",
  tradeindia: "TradeIndia",
};

function titleCase(s: string | null) {
  if (!s) return "—";
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AdminContacts() {
  const { toast } = useToast();
  const [country, setCountry] = useState("");
  const [buyerType, setBuyerType] = useState("");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleting, setDeleting] = useState<Contact | null>(null);

  // Build the list URL from filters; used as the react-query key too.
  const listUrl = useMemo(() => {
    const p = new URLSearchParams();
    if (country.trim()) p.set("country", country.trim());
    if (buyerType) p.set("buyerType", buyerType);
    if (search.trim()) p.set("search", search.trim());
    const qs = p.toString();
    return `/api/admin/contacts${qs ? `?${qs}` : ""}`;
  }, [country, buyerType, search]);

  const { data: contacts, isLoading } = useQuery<Contact[]>({ queryKey: [listUrl] });

  // Distinct countries (from the unfiltered fetch we have) for the filter chips.
  const countries = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts ?? []) if (c.country) set.add(c.country);
    return Array.from(set).sort();
  }, [contacts]);

  const invalidate = () =>
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/admin/contacts") });

  const deleteContact = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/contacts/${id}`),
    onSuccess: () => {
      toast({ title: "Contact deleted" });
      setDeleting(null);
      invalidate();
    },
    onError: () => toast({ title: "Failed to delete contact", variant: "destructive" }),
  });

  const suppress = useMutation({
    mutationFn: (c: Contact) =>
      apiRequest("POST", "/api/admin/contacts/suppress", {
        email: c.email ?? undefined,
        phone: c.phone ?? undefined,
        reason: "manual",
      }),
    onSuccess: () => {
      toast({ title: "Added to do-not-contact list" });
      invalidate();
    },
    onError: () => toast({ title: "Failed to suppress", variant: "destructive" }),
  });

  const unsuppress = useMutation({
    mutationFn: (c: Contact) =>
      apiRequest("POST", "/api/admin/contacts/unsuppress", {
        email: c.email ?? undefined,
        phone: c.phone ?? undefined,
      }),
    onSuccess: () => {
      toast({ title: "Contact re-enabled" });
      invalidate();
    },
    onError: () => toast({ title: "Failed to re-enable contact", variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">
            Your outbound address book — imported prospects and promoted leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)} data-testid="button-import-csv">
            <Upload className="mr-2 h-4 w-4" /> Import CSV
          </Button>
          <Button onClick={() => setAddOpen(true)} data-testid="button-add-contact">
            <Plus className="mr-2 h-4 w-4" /> Add contact
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <div className="grid gap-1.5">
            <Label htmlFor="f-search">Search</Label>
            <Input
              id="f-search"
              placeholder="Company, city, country…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-56"
              data-testid="input-search"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-country">Country</Label>
            <Select value={country || "__all"} onValueChange={(v) => setCountry(v === "__all" ? "" : v)}>
              <SelectTrigger id="f-country" className="w-44" data-testid="select-country">
                <SelectValue placeholder="All countries" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All countries</SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-type">Buyer type</Label>
            <Select value={buyerType || "__all"} onValueChange={(v) => setBuyerType(v === "__all" ? "" : v)}>
              <SelectTrigger id="f-type" className="w-44 capitalize" data-testid="select-buyer-type">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">All types</SelectItem>
                {BUYER_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(country || buyerType || search) && (
            <Button
              variant="ghost"
              onClick={() => {
                setCountry("");
                setBuyerType("");
                setSearch("");
              }}
            >
              Clear
            </Button>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <Card>
          <CardContent className="pt-6">
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      ) : (contacts?.length ?? 0) > 0 ? (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-3 text-sm text-muted-foreground">{contacts!.length} contacts</div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name / Company</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts!.map((c) => (
                    <TableRow
                      key={c.id}
                      data-testid={`row-contact-${c.id}`}
                      className={cn(c.optedOut && "opacity-50")}
                    >
                      <TableCell className="font-medium">
                        <div>{c.name || c.company || "Unknown"}</div>
                        {c.company && c.name && (
                          <div className="text-xs text-muted-foreground">{c.company}</div>
                        )}
                        <div className="mt-0.5 flex flex-col gap-0.5">
                          {c.phone && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              {c.phone}
                            </span>
                          )}
                          {c.email && (
                            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                              <Mail className="h-3 w-3" />
                              {c.email}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{titleCase(c.buyerType)}</TableCell>
                      <TableCell>
                        {[c.city, c.country].filter(Boolean).join(", ") || "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{SOURCE_LABELS[c.source] ?? c.source}</Badge>
                        {c.optedOut && (
                          <Badge className="ml-1 border-transparent bg-red-100 text-red-700">
                            Opted out
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {c.tags.slice(0, 3).map((t) => (
                            <Badge key={t} variant="outline" className="text-xs">
                              {t}
                            </Badge>
                          ))}
                          {c.tags.length > 3 && (
                            <span className="text-xs text-muted-foreground">+{c.tags.length - 3}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Contact actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {c.optedOut ? (
                              <DropdownMenuItem onClick={() => unsuppress.mutate(c)}>
                                <CheckCircle2 className="mr-2 h-4 w-4" /> Allow contact again
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => suppress.mutate(c)}>
                                <Ban className="mr-2 h-4 w-4" /> Do not contact
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-red-600 focus:text-red-700"
                              onClick={() => setDeleting(c)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="mx-auto mb-4 h-12 w-12 text-muted-foreground opacity-50" />
            <h3 className="mb-2 font-semibold">No contacts yet</h3>
            <p className="mb-4 text-muted-foreground">
              Import a prospect list from CSV, or add contacts one at a time.
            </p>
            <Button onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import CSV
            </Button>
          </CardContent>
        </Card>
      )}

      <AddContactDialog open={addOpen} onClose={() => setAddOpen(false)} onSaved={invalidate} />
      <ImportCsvDialog open={importOpen} onClose={() => setImportOpen(false)} onImported={invalidate} />

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this contact?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the contact from your address book. It does not affect any lead it was
              promoted from. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteContact.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={(e) => {
                e.preventDefault();
                if (deleting) deleteContact.mutate(deleting.id);
              }}
              disabled={deleteContact.isPending}
              data-testid="button-confirm-delete-contact"
            >
              {deleteContact.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Deleting…
                </>
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Add contact dialog ──────────────────────────────────────────────────
function AddContactDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const empty = { name: "", email: "", phone: "", company: "", country: "", city: "", buyerType: "" };
  const [draft, setDraft] = useState(empty);

  const save = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(draft)) if (v.trim()) body[k] = v.trim();
      await apiRequest("POST", "/api/admin/contacts", body);
    },
    onSuccess: () => {
      toast({ title: "Contact added" });
      setDraft(empty);
      onSaved();
      onClose();
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't add contact",
        description: /email or phone/.test(err.message) ? "Add at least an email or phone." : undefined,
        variant: "destructive",
      }),
  });

  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft({ ...draft, [k]: e.target.value });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add contact</DialogTitle>
          <DialogDescription>A contact needs at least an email or a phone number.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ac-name">Name</Label>
            <Input id="ac-name" value={draft.name} onChange={set("name")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ac-email">Email</Label>
              <Input id="ac-email" type="email" value={draft.email} onChange={set("email")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-phone">Phone</Label>
              <Input id="ac-phone" value={draft.phone} onChange={set("phone")} placeholder="+971…" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ac-company">Company</Label>
            <Input id="ac-company" value={draft.company} onChange={set("company")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ac-city">City</Label>
              <Input id="ac-city" value={draft.city} onChange={set("city")} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ac-country">Country</Label>
              <Input id="ac-country" value={draft.country} onChange={set("country")} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ac-type">Buyer type</Label>
            <Select value={draft.buyerType} onValueChange={(v) => setDraft({ ...draft, buyerType: v })}>
              <SelectTrigger id="ac-type" className="capitalize">
                <SelectValue placeholder="Select…" />
              </SelectTrigger>
              <SelectContent>
                {BUYER_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-contact">
            {save.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
              </>
            ) : (
              "Add contact"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── CSV import wizard ───────────────────────────────────────────────────
interface PreviewResponse {
  preset: CsvPreset;
  rowsTotal: number;
  validCount: number;
  errorCount: number;
  errors: { row: number; reason: string }[];
  sample: InputContactDraft[];
}
interface CommitResponse {
  preset: CsvPreset;
  rowsTotal: number;
  imported: number;
  skipped: number;
}

function ImportCsvDialog({
  open,
  onClose,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const reset = () => {
    setCsv("");
    setFilename("");
    setPreview(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const close = () => {
    reset();
    onClose();
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setFilename(file.name);
    setPreview(null);
  };

  const runPreview = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/contacts/import/preview", { csv });
      return (await res.json()) as PreviewResponse;
    },
    onSuccess: (data) => setPreview(data),
    onError: () => toast({ title: "Couldn't read that file", variant: "destructive" }),
  });

  const runCommit = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/contacts/import/commit", { csv, filename });
      return (await res.json()) as CommitResponse;
    },
    onSuccess: (data) => {
      toast({
        title: `Imported ${data.imported} contact${data.imported === 1 ? "" : "s"}`,
        description:
          data.skipped > 0 ? `${data.skipped} skipped (duplicates or already present).` : undefined,
      });
      onImported();
      close();
    },
    onError: () => toast({ title: "Import failed", variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import contacts from CSV</DialogTitle>
          <DialogDescription>
            Upload a CSV export. We auto-detect IndiaMART, Alibaba, and TradeIndia formats, or map
            generic columns by name. Rows need at least an email or phone.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Format guidance + a downloadable template so users know the shape. */}
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="mb-1 font-medium">CSV format</div>
            <p className="text-muted-foreground">
              First row must be column headers. Recognised columns:{" "}
              <span className="font-medium text-foreground">
                Name, Email, Phone, Company, Country, City, Buyer Type, Tags, Notes
              </span>
              . Only Email or Phone is required per row; separate multiple tags with a comma or
              semicolon. Exports from IndiaMART, Alibaba and TradeIndia are detected automatically.
            </p>
            <a
              href="/sample-contacts.csv"
              download
              className="mt-2 inline-flex items-center gap-1 font-medium text-coral hover:text-coral-dark"
              data-testid="link-sample-csv"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Download sample template
            </a>
          </div>

          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="hidden"
              data-testid="input-csv-file"
            />
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Choose file
            </Button>
            <span className="text-sm text-muted-foreground">{filename || "No file chosen"}</span>
          </div>

          {csv && !preview && (
            <Button
              onClick={() => runPreview.mutate()}
              disabled={runPreview.isPending}
              data-testid="button-preview-csv"
            >
              {runPreview.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Reading…
                </>
              ) : (
                "Preview"
              )}
            </Button>
          )}

          {preview && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">{SOURCE_LABELS[preview.preset] ?? preview.preset}</Badge>
                <span>
                  <strong>{preview.validCount}</strong> ready ·{" "}
                  <strong>{preview.errorCount}</strong> skipped · {preview.rowsTotal} rows total
                </span>
              </div>

              {preview.sample.length > 0 && (
                <div className="overflow-x-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Country</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preview.sample.slice(0, 8).map((d, i) => (
                        <TableRow key={i}>
                          <TableCell>{d.name || "—"}</TableCell>
                          <TableCell>{d.email || "—"}</TableCell>
                          <TableCell>{d.phone || "—"}</TableCell>
                          <TableCell>{d.country || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              {preview.errorCount > 0 && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground">
                    {preview.errorCount} rows will be skipped
                  </summary>
                  <ul className="mt-1 max-h-32 overflow-auto pl-4">
                    {preview.errors.slice(0, 20).map((e) => (
                      <li key={e.row} className="text-xs text-muted-foreground">
                        Row {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={runCommit.isPending}>
            Cancel
          </Button>
          {preview && (
            <Button
              onClick={() => runCommit.mutate()}
              disabled={runCommit.isPending || preview.validCount === 0}
              data-testid="button-commit-csv"
            >
              {runCommit.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Importing…
                </>
              ) : (
                `Import ${preview.validCount} contacts`
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
