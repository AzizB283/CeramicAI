import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BookOpen, ExternalLink, Plus, Pencil, Trash2 } from "lucide-react";

// ── Domain values ────────────────────────────────────────────────────
//
// Categories + audience match what the backend Zod validator accepts. Sizes
// + finishes are presented as fixed sets for now (matching the spec) but the
// stored value is just string[] so a factory could add custom sizes via a
// future "Other" input without a schema change.

const CATEGORIES = [
  { value: "ceramic_wall", label: "Ceramic Wall Tiles" },
  { value: "gvt", label: "GVT / Vitrified" },
  { value: "pgvt", label: "PGVT (Polished Glazed Vitrified)" },
  { value: "double_charge", label: "Double Charge" },
  { value: "slab", label: "Slab (Large Format)" },
  { value: "sanitaryware", label: "Sanitaryware" },
  { value: "mixed", label: "Mixed / General Catalogue" },
] as const;

const AUDIENCES = [
  { value: "domestic", label: "Domestic" },
  { value: "export", label: "Export" },
  { value: "both", label: "Both" },
] as const;

const SIZES = ["300x600", "600x600", "800x800", "1200x600", "1200x1200", "1200x2400"];
const FINISHES = ["Glossy", "Matte", "Sugar", "Carving", "Natural Look"];

// ── Types matching the API response ──────────────────────────────────

interface Catalogue {
  id: number;
  title: string;
  category: string;
  audience: string;
  url: string;
  description: string | null;
  sizes: string[];
  finishes: string[];
  isActive: boolean;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
}

interface CatalogueDraft {
  title: string;
  category: string;
  audience: string;
  url: string;
  description: string;
  sizes: string[];
  finishes: string[];
  isActive: boolean;
}

const EMPTY_DRAFT: CatalogueDraft = {
  title: "",
  category: "gvt",
  audience: "both",
  url: "",
  description: "",
  sizes: [],
  finishes: [],
  isActive: true,
};

function categoryLabel(value: string) {
  return CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

// ── Page ─────────────────────────────────────────────────────────────

export default function AdminCatalogues() {
  const { toast } = useToast();
  const { data: catalogues, isLoading } = useQuery<Catalogue[]>({
    queryKey: ["/api/admin/catalogues"],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Catalogue | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (cat: Catalogue) => {
    setEditing(cat);
    setDialogOpen(true);
  };

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/admin/catalogues/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalogues"] });
      toast({ title: "Catalogue deleted" });
    },
    onError: () => toast({ title: "Failed to delete", variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: number; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/admin/catalogues/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalogues"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Catalogues</h1>
          <p className="text-muted-foreground">
            Product catalogues shared with buyers — paste a Google Drive, Dropbox, or hosted PDF
            link. Designs change often, so update the link rather than the products.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4 mr-2" />
              Add Catalogue
            </Button>
          </DialogTrigger>
          <CatalogueDialog
            key={editing?.id ?? "new"}
            editing={editing}
            onClose={() => setDialogOpen(false)}
          />
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !catalogues || catalogues.length === 0 ? (
            <EmptyState onAdd={openCreate} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Audience</TableHead>
                  <TableHead>Sizes</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogues.map((cat) => (
                  <TableRow key={cat.id} className={!cat.isActive ? "opacity-60" : undefined}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{cat.title}</span>
                        {cat.description && (
                          <span className="text-xs text-muted-foreground line-clamp-1">
                            {cat.description}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{categoryLabel(cat.category)}</Badge>
                    </TableCell>
                    <TableCell>
                      <AudienceBadge audience={cat.audience} />
                    </TableCell>
                    <TableCell className="text-sm">
                      {cat.sizes.length > 0 ? (
                        <span className="text-muted-foreground">
                          {cat.sizes.slice(0, 3).join(", ")}
                          {cat.sizes.length > 3 ? ` +${cat.sizes.length - 3}` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={cat.isActive}
                        onCheckedChange={(v) =>
                          toggleActiveMutation.mutate({ id: cat.id, isActive: v })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button asChild size="sm" variant="ghost" title="Open link">
                          <a href={cat.url} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(cat)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <DeleteButton onConfirm={() => deleteMutation.mutate(cat.id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <BookOpen className="h-10 w-10 text-muted-foreground mb-4" />
      <h3 className="text-lg font-semibold">No catalogues yet</h3>
      <p className="text-sm text-muted-foreground mb-4 max-w-md">
        Add your first product catalogue. The bot will share it with buyers when they ask about a
        matching category, size, or finish.
      </p>
      <Button onClick={onAdd}>
        <Plus className="h-4 w-4 mr-2" />
        Add Catalogue
      </Button>
    </div>
  );
}

function AudienceBadge({ audience }: { audience: string }) {
  if (audience === "export") return <Badge className="bg-blue-500/15 text-blue-700 border-blue-500/30">Export</Badge>;
  if (audience === "domestic") return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30">Domestic</Badge>;
  return <Badge variant="outline">Both</Badge>;
}

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this catalogue?</AlertDialogTitle>
          <AlertDialogDescription>
            The bot will stop sharing this link with buyers. This action can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Delete</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Add/Edit dialog ──────────────────────────────────────────────────

function CatalogueDialog({
  editing,
  onClose,
}: {
  editing: Catalogue | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = useState<CatalogueDraft>(
    editing
      ? {
          title: editing.title,
          category: editing.category,
          audience: editing.audience,
          url: editing.url,
          description: editing.description ?? "",
          sizes: editing.sizes,
          finishes: editing.finishes,
          isActive: editing.isActive,
        }
      : EMPTY_DRAFT,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...draft,
        description: draft.description.trim() || null,
      };
      const res = editing
        ? await apiRequest("PATCH", `/api/admin/catalogues/${editing.id}`, payload)
        : await apiRequest("POST", "/api/admin/catalogues", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/catalogues"] });
      toast({ title: editing ? "Catalogue updated" : "Catalogue added" });
      onClose();
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const toggleSize = (size: string) =>
    setDraft((d) => ({
      ...d,
      sizes: d.sizes.includes(size) ? d.sizes.filter((s) => s !== size) : [...d.sizes, size],
    }));
  const toggleFinish = (finish: string) =>
    setDraft((d) => ({
      ...d,
      finishes: d.finishes.includes(finish)
        ? d.finishes.filter((f) => f !== finish)
        : [...d.finishes, finish],
    }));

  const canSave =
    draft.title.trim().length > 0 && /^https?:\/\//i.test(draft.url.trim());

  return (
    <DialogContent className="sm:max-w-[640px]">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit Catalogue" : "Add Catalogue"}</DialogTitle>
        <DialogDescription>
          Paste a publicly accessible Google Drive, Dropbox, or hosted PDF link. Tag it with the
          right category and sizes so the bot can pick the best match for each buyer.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 py-2">
        {/* Title */}
        <div className="grid gap-2">
          <Label htmlFor="title">Title</Label>
          <Input
            id="title"
            placeholder="e.g. GVT Catalogue 2026"
            value={draft.title}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          />
        </div>

        {/* Category + Audience */}
        <div className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label>Category</Label>
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Audience</Label>
            <Select value={draft.audience} onValueChange={(v) => setDraft({ ...draft, audience: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIENCES.map((a) => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* URL */}
        <div className="grid gap-2">
          <Label htmlFor="url">Catalogue URL</Label>
          <div className="flex gap-2">
            <Input
              id="url"
              placeholder="https://drive.google.com/..."
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
            {/^https?:\/\//i.test(draft.url) && (
              <Button asChild variant="outline" size="icon" title="Test link">
                <a href={draft.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            )}
          </div>
        </div>

        {/* Description */}
        <div className="grid gap-2">
          <Label htmlFor="desc">Description (optional)</Label>
          <Textarea
            id="desc"
            rows={2}
            placeholder="e.g. Updated Jan 2026 — includes new 1200×1200 designs"
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
        </div>

        {/* Sizes */}
        <div className="grid gap-2">
          <Label>Sizes featured</Label>
          <div className="flex flex-wrap gap-3">
            {SIZES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={draft.sizes.includes(s)}
                  onCheckedChange={() => toggleSize(s)}
                />
                {s}
              </label>
            ))}
          </div>
        </div>

        {/* Finishes */}
        <div className="grid gap-2">
          <Label>Finishes featured</Label>
          <div className="flex flex-wrap gap-3">
            {FINISHES.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={draft.finishes.includes(f)}
                  onCheckedChange={() => toggleFinish(f)}
                />
                {f}
              </label>
            ))}
          </div>
        </div>

        {/* Active */}
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="active">Active</Label>
            <p className="text-xs text-muted-foreground">
              Inactive catalogues are hidden from the bot until re-enabled.
            </p>
          </div>
          <Switch
            id="active"
            checked={draft.isActive}
            onCheckedChange={(v) => setDraft({ ...draft, isActive: v })}
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
          Cancel
        </Button>
        <Button onClick={() => saveMutation.mutate()} disabled={!canSave || saveMutation.isPending}>
          {saveMutation.isPending ? "Saving…" : editing ? "Save Changes" : "Add Catalogue"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
