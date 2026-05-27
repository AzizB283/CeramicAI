import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

interface CeramicSettings {
  id: string;
  name: string;
  mode: string;
  ownerName: string | null;
  ownerWhatsapp: string | null;
  catalogUrl: string | null;
  exportCatalogUrl: string | null;
  widgetName: string | null;
  widgetGreeting: string | null;
  widgetColor: string | null;
  timezone: string | null;
  active: boolean;
}

type SettingsForm = {
  name: string;
  ownerName: string;
  ownerWhatsapp: string;
  catalogUrl: string;
  exportCatalogUrl: string;
  widgetName: string;
  widgetGreeting: string;
  widgetColor: string;
};

const EMPTY_FORM: SettingsForm = {
  name: "",
  ownerName: "",
  ownerWhatsapp: "",
  catalogUrl: "",
  exportCatalogUrl: "",
  widgetName: "",
  widgetGreeting: "",
  widgetColor: "e85d04",
};

export default function AdminSettings() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<CeramicSettings>({
    queryKey: ["/api/admin/settings"],
  });

  const [form, setForm] = useState<SettingsForm>(EMPTY_FORM);

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name ?? "",
        ownerName: settings.ownerName ?? "",
        ownerWhatsapp: settings.ownerWhatsapp ?? "",
        catalogUrl: settings.catalogUrl ?? "",
        exportCatalogUrl: settings.exportCatalogUrl ?? "",
        widgetName: settings.widgetName ?? "",
        widgetGreeting: settings.widgetGreeting ?? "",
        widgetColor: settings.widgetColor ?? "e85d04",
      });
    }
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: (data: SettingsForm) =>
      apiRequest("PATCH", "/api/admin/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: () => {
      toast({ title: "Failed to save settings", variant: "destructive" });
    },
  });

  const set = (key: keyof SettingsForm) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(form);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-muted-foreground">Bot and business configuration</p>
        </div>
        <Card>
          <CardContent className="space-y-4 pt-6">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Bot and business configuration</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Business</CardTitle>
            <CardDescription>
              How CeramicBot identifies your company and owner.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Business name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={set("name")}
                placeholder="Shree Tiles Pvt Ltd"
                data-testid="input-name"
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="ownerName">Owner name</Label>
                <Input
                  id="ownerName"
                  value={form.ownerName}
                  onChange={set("ownerName")}
                  placeholder="Owner / sales lead"
                  data-testid="input-owner-name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ownerWhatsapp">Owner WhatsApp</Label>
                <Input
                  id="ownerWhatsapp"
                  value={form.ownerWhatsapp}
                  onChange={set("ownerWhatsapp")}
                  placeholder="+91 98765 43210"
                  data-testid="input-owner-whatsapp"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Catalogs</CardTitle>
            <CardDescription>
              Links sent to buyers during the chat flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="catalogUrl">Product catalog URL</Label>
              <Input
                id="catalogUrl"
                value={form.catalogUrl}
                onChange={set("catalogUrl")}
                placeholder="https://…/catalog.pdf"
                data-testid="input-catalog-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="exportCatalogUrl">Export catalog URL</Label>
              <Input
                id="exportCatalogUrl"
                value={form.exportCatalogUrl}
                onChange={set("exportCatalogUrl")}
                placeholder="https://…/catalog-export.pdf"
                data-testid="input-export-catalog-url"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Chat widget</CardTitle>
            <CardDescription>
              Brand the bot to match your factory — name, greeting, and theme color.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="widgetName">Bot name</Label>
              <Input
                id="widgetName"
                value={form.widgetName}
                onChange={set("widgetName")}
                placeholder="CeramicBot"
                data-testid="input-widget-name"
              />
              <p className="text-xs text-muted-foreground">
                Shown in the chat header and the floating button. Defaults to "CeramicBot".
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="widgetGreeting">Welcome message</Label>
              <Textarea
                id="widgetGreeting"
                value={form.widgetGreeting}
                onChange={set("widgetGreeting")}
                placeholder="Hi! Looking for ceramic tiles? Tell us what you need."
                rows={3}
                data-testid="input-widget-greeting"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="widgetColor">Theme color</Label>
              <div className="flex items-center gap-3">
                <input
                  id="widgetColor"
                  type="color"
                  value={`#${form.widgetColor.replace(/^#/, "")}`}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, widgetColor: e.target.value.replace(/^#/, "") }))
                  }
                  className="h-10 w-14 cursor-pointer rounded-md border bg-background"
                  data-testid="input-widget-color"
                />
                <Input
                  value={form.widgetColor}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      widgetColor: e.target.value.replace(/^#/, "").slice(0, 6),
                    }))
                  }
                  placeholder="e85d04"
                  maxLength={6}
                  className="font-mono w-32"
                />
                <div
                  className="h-10 flex-1 rounded-md border"
                  style={{ backgroundColor: `#${form.widgetColor || "e85d04"}` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Hex without the #. Used for the chat button, user bubbles, and accents.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            data-testid="button-save-settings"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
