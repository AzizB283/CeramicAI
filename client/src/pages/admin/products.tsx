import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, X, Package } from "lucide-react";

// ── Domain values ────────────────────────────────────────────────────
//
// The 6 standard categories + "other" for a factory's custom product. These
// values match the backend Zod validator and the static option `value`s in
// shared/flows.ts — that's how the engine connects what the factory ticks
// here with the chips a buyer sees in the chat.

const CATEGORIES = [
  { value: "ceramic_wall", label: "Ceramic Wall Tiles" },
  { value: "gvt", label: "GVT / Vitrified Floor" },
  { value: "pgvt", label: "PGVT (Polished Glazed Vitrified)" },
  { value: "double_charge", label: "Double Charge" },
  { value: "slab", label: "Slab (Large Format)" },
  { value: "sanitaryware", label: "Sanitaryware" },
] as const;

const DEFAULT_SIZES = ["300x600", "600x600", "800x800", "1200x600", "1200x1200", "1200x2400"];
const DEFAULT_FINISHES = ["Glossy", "Matte", "Sugar", "Carving", "Natural Look"];
const DEFAULT_SANI_ITEMS = [
  "One-piece toilet",
  "Two-piece toilet",
  "Wash basin (counter)",
  "Wash basin (pedestal)",
  "Wash basin (wall-hung)",
  "Urinal",
  "Cistern",
  "Bidet",
];

// ── Types ────────────────────────────────────────────────────────────

interface ProductRow {
  id: number;
  category: string;
  customLabel: string | null;
  sizes: string[];
  finishes: string[];
  subItems: string[];
  isActive: boolean;
  displayOrder: number;
}

interface ProductDraft {
  category: string;
  customLabel: string;
  sizes: string[];
  finishes: string[];
  subItems: string[];
  isActive: boolean;
  displayOrder: number;
}

function makeDefaultDraft(category: string): ProductDraft {
  return {
    category,
    customLabel: "",
    sizes: [],
    finishes: [],
    subItems: [],
    isActive: true,
    displayOrder: 0,
  };
}

export default function AdminProducts() {
  const { toast } = useToast();
  const { data: rows, isLoading } = useQuery<ProductRow[]>({
    queryKey: ["/api/admin/products"],
  });

  const [drafts, setDrafts] = useState<ProductDraft[]>([]);
  const [customSizes, setCustomSizes] = useState<Record<number, string>>({});
  const [customFinishes, setCustomFinishes] = useState<Record<number, string>>({});
  const [customSubItems, setCustomSubItems] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!rows) return;
    setDrafts(
      rows.map((r) => ({
        category: r.category,
        customLabel: r.customLabel ?? "",
        sizes: r.sizes ?? [],
        finishes: r.finishes ?? [],
        subItems: r.subItems ?? [],
        isActive: r.isActive,
        displayOrder: r.displayOrder,
      })),
    );
  }, [rows]);

  const availableCategories = useMemo(() => {
    const used = new Set(drafts.map((d) => d.category));
    return CATEGORIES.filter((c) => !used.has(c.value));
  }, [drafts]);

  const saveMutation = useMutation({
    mutationFn: (items: ProductDraft[]) =>
      apiRequest("PUT", "/api/admin/products", {
        items: items.map((d, i) => ({
          category: d.category,
          customLabel: d.customLabel.trim() || null,
          sizes: d.sizes,
          finishes: d.finishes,
          subItems: d.subItems,
          isActive: d.isActive,
          displayOrder: i,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/products"] });
      toast({ title: "Products saved" });
    },
    onError: () => {
      toast({ title: "Failed to save products", variant: "destructive" });
    },
  });

  const addCategory = (value: string) => {
    setDrafts((prev) => [...prev, makeDefaultDraft(value)]);
  };

  const removeCategory = (index: number) => {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const updateDraft = (index: number, patch: Partial<ProductDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  };

  const toggleListItem = (index: number, field: "sizes" | "finishes" | "subItems", value: string) => {
    setDrafts((prev) =>
      prev.map((d, i) => {
        if (i !== index) return d;
        const list = d[field];
        return {
          ...d,
          [field]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
        };
      }),
    );
  };

  const addCustomChip = (
    index: number,
    field: "sizes" | "finishes" | "subItems",
    bucket: Record<number, string>,
    setBucket: (next: Record<number, string>) => void,
  ) => {
    const raw = bucket[index]?.trim();
    if (!raw) return;
    setDrafts((prev) =>
      prev.map((d, i) =>
        i === index && !d[field].includes(raw) ? { ...d, [field]: [...d[field], raw] } : d,
      ),
    );
    setBucket({ ...bucket, [index]: "" });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-muted-foreground">
            Which categories, sizes, and finishes does your factory sell?
          </p>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Products</h1>
          <p className="text-muted-foreground">
            Configure what your factory actually offers. The bot will only show buyers
            categories and sizes you've selected here.
          </p>
        </div>
        <Button
          onClick={() => saveMutation.mutate(drafts)}
          disabled={saveMutation.isPending}
          data-testid="button-save-products"
        >
          {saveMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </div>

      {drafts.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Package className="h-10 w-10 text-muted-foreground" />
            <div className="space-y-1">
              <p className="font-medium">No products configured yet</p>
              <p className="text-sm text-muted-foreground">
                Until you add categories, the bot will show buyers all 6 default
                categories with the default sizes and finishes.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {drafts.map((draft, index) => {
        const meta = CATEGORIES.find((c) => c.value === draft.category);
        const isSani = draft.category === "sanitaryware";
        const title = meta?.label ?? draft.category;
        return (
          <Card key={`${draft.category}-${index}`} data-testid={`product-card-${draft.category}`}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-lg">{title}</CardTitle>
                <CardDescription>
                  {isSani
                    ? "Pick which sanitaryware items you sell. Sizes are skipped in the chat for these."
                    : "Pick which sizes and finishes you offer for this category."}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Label htmlFor={`active-${index}`} className="text-xs text-muted-foreground">
                  {draft.isActive ? "Active" : "Hidden"}
                </Label>
                <Switch
                  id={`active-${index}`}
                  checked={draft.isActive}
                  onCheckedChange={(v) => updateDraft(index, { isActive: v })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCategory(index)}
                  aria-label="Remove category"
                  data-testid={`button-remove-${draft.category}`}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {!isSani && (
                <>
                  <ChipPicker
                    label="Sizes"
                    options={DEFAULT_SIZES}
                    selected={draft.sizes}
                    onToggle={(v) => toggleListItem(index, "sizes", v)}
                    customValue={customSizes[index] ?? ""}
                    onCustomChange={(v) => setCustomSizes({ ...customSizes, [index]: v })}
                    onAddCustom={() => addCustomChip(index, "sizes", customSizes, setCustomSizes)}
                    placeholder="e.g. 600x1200"
                  />
                  <ChipPicker
                    label="Finishes"
                    options={DEFAULT_FINISHES}
                    selected={draft.finishes}
                    onToggle={(v) => toggleListItem(index, "finishes", v)}
                    customValue={customFinishes[index] ?? ""}
                    onCustomChange={(v) => setCustomFinishes({ ...customFinishes, [index]: v })}
                    onAddCustom={() =>
                      addCustomChip(index, "finishes", customFinishes, setCustomFinishes)
                    }
                    placeholder="e.g. Rustic"
                  />
                </>
              )}
              {isSani && (
                <ChipPicker
                  label="Items"
                  options={DEFAULT_SANI_ITEMS}
                  selected={draft.subItems}
                  onToggle={(v) => toggleListItem(index, "subItems", v)}
                  customValue={customSubItems[index] ?? ""}
                  onCustomChange={(v) => setCustomSubItems({ ...customSubItems, [index]: v })}
                  onAddCustom={() =>
                    addCustomChip(index, "subItems", customSubItems, setCustomSubItems)
                  }
                  placeholder="e.g. Squatting pan"
                />
              )}
            </CardContent>
          </Card>
        );
      })}

      {availableCategories.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add a category</CardTitle>
            <CardDescription>
              Pick a category your factory sells. You can configure its sizes/finishes below.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {availableCategories.map((c) => (
              <Button
                key={c.value}
                variant="outline"
                size="sm"
                onClick={() => addCategory(c.value)}
                data-testid={`button-add-${c.value}`}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {c.label}
              </Button>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── ChipPicker ──────────────────────────────────────────────────────
// Multi-select chips with a custom "add your own" input.

function ChipPicker({
  label,
  options,
  selected,
  onToggle,
  customValue,
  onCustomChange,
  onAddCustom,
  placeholder,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  customValue: string;
  onCustomChange: (value: string) => void;
  onAddCustom: () => void;
  placeholder: string;
}) {
  // Show all default options plus any custom values the factory previously added.
  const customAdditions = selected.filter((s) => !options.includes(s));
  const allOptions = [...options, ...customAdditions];

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">{label}</Label>
      <div className="flex flex-wrap gap-2">
        {allOptions.map((opt) => {
          const isSelected = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-input bg-background hover:bg-accent"
              }`}
              data-testid={`chip-${label.toLowerCase()}-${opt}`}
            >
              <Checkbox checked={isSelected} className="h-3 w-3 pointer-events-none" />
              {opt}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={customValue}
          onChange={(e) => onCustomChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAddCustom();
            }
          }}
          placeholder={placeholder}
          className="h-8 max-w-xs text-xs"
        />
        <Button type="button" variant="outline" size="sm" onClick={onAddCustom} className="h-8">
          <Plus className="mr-1 h-3 w-3" />
          Add
        </Button>
      </div>
    </div>
  );
}
