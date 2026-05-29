import { useState } from "react";
import { Link } from "wouter";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Copy, ChevronRight } from "lucide-react";

interface ClientRow {
  id: string;
  name: string;
  slug: string;
  mode: string;
  active: boolean;
  leadCount: number;
  productCount: number;
  adminCount: number;
}

interface CreatedCredentials {
  clientName: string;
  slug: string;
  username: string;
  password: string;
}

const EMPTY_FORM = {
  name: "",
  slug: "",
  mode: "factory",
  ownerName: "",
  ownerWhatsapp: "",
  adminUsername: "",
  adminPassword: "",
  adminName: "",
};

export default function SuperAdminClients() {
  const { toast } = useToast();
  const { data: clients, isLoading } = useQuery<ClientRow[]>({
    queryKey: ["/api/superadmin/clients"],
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [created, setCreated] = useState<CreatedCredentials | null>(null);

  const set = (key: keyof typeof EMPTY_FORM) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/superadmin/clients", {
        name: form.name,
        slug: form.slug,
        mode: form.mode,
        ownerName: form.ownerName || undefined,
        ownerWhatsapp: form.ownerWhatsapp || undefined,
        adminUsername: form.adminUsername,
        adminPassword: form.adminPassword,
        adminName: form.adminName || undefined,
      });
      return res.json() as Promise<{
        client: { name: string; slug: string };
        admin: { username: string; password: string };
      }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/superadmin/clients"] });
      setCreated({
        clientName: data.client.name,
        slug: data.client.slug,
        username: data.admin.username,
        password: data.admin.password,
      });
      setForm({ ...EMPTY_FORM });
    },
    onError: (err: Error) => {
      toast({ title: "Could not create factory", description: err.message, variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setOpen(false);
    setCreated(null);
    setForm({ ...EMPTY_FORM });
  };

  const copyCreds = () => {
    if (!created) return;
    const text = `Factory: ${created.clientName}\nLogin URL: /login\nUsername: ${created.username}\nPassword: ${created.password}`;
    void navigator.clipboard.writeText(text);
    toast({ title: "Credentials copied" });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Factories</h1>
          <p className="text-muted-foreground">
            Every CeramicBot tenant. Create one, hand off its login, or open its panel to help.
          </p>
        </div>

        <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : closeDialog())}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-factory">
              <Plus className="mr-2 h-4 w-4" />
              Create factory
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            {!created ? (
              <>
                <DialogHeader>
                  <DialogTitle>Create a factory</DialogTitle>
                  <DialogDescription>
                    Provisions the tenant and its first admin login. The slug is permanent —
                    it's the WhatsApp webhook + embed identifier.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="grid gap-2">
                    <Label htmlFor="name">Factory name</Label>
                    <Input id="name" value={form.name} onChange={set("name")} placeholder="Shree Tiles Pvt Ltd" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="slug">Slug (permanent)</Label>
                      <Input
                        id="slug"
                        value={form.slug}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "") }))
                        }
                        placeholder="shree-tiles"
                        className="font-mono"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="mode">Mode</Label>
                      <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v }))}>
                        <SelectTrigger id="mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="factory">Factory (domestic)</SelectItem>
                          <SelectItem value="exporter">Exporter (international)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="ownerName">Owner name</Label>
                      <Input id="ownerName" value={form.ownerName} onChange={set("ownerName")} placeholder="Optional" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="ownerWhatsapp">Owner WhatsApp</Label>
                      <Input id="ownerWhatsapp" value={form.ownerWhatsapp} onChange={set("ownerWhatsapp")} placeholder="Optional" />
                    </div>
                  </div>
                  <div className="border-t pt-3" />
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="adminUsername">Admin username</Label>
                      <Input id="adminUsername" value={form.adminUsername} onChange={set("adminUsername")} placeholder="shree-admin" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="adminPassword">Admin password</Label>
                      <Input id="adminPassword" type="text" value={form.adminPassword} onChange={set("adminPassword")} placeholder="min 8 chars" />
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={closeDialog}>Cancel</Button>
                  <Button
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending || !form.name || form.slug.length < 2 || !form.adminUsername || form.adminPassword.length < 8}
                  >
                    {createMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Create
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Factory created</DialogTitle>
                  <DialogDescription>
                    Copy these credentials now — the password is shown only once. Hand them to the factory.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
                  <div>Factory: {created.clientName}</div>
                  <div>Slug: {created.slug}</div>
                  <div>Username: {created.username}</div>
                  <div>Password: {created.password}</div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={copyCreds}>
                    <Copy className="mr-2 h-4 w-4" />
                    Copy
                  </Button>
                  <Button onClick={closeDialog}>Done</Button>
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Factory</TableHead>
                  <TableHead>Slug</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Products</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients?.map((c) => (
                  <TableRow key={c.id} data-testid={`row-client-${c.slug}`}>
                    <TableCell className="font-medium">
                      {c.name}
                      {c.slug === "demo" && (
                        <Badge variant="secondary" className="ml-2 text-xs">demo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{c.slug}</TableCell>
                    <TableCell className="capitalize">{c.mode}</TableCell>
                    <TableCell className="text-right">{c.leadCount}</TableCell>
                    <TableCell className="text-right">{c.productCount}</TableCell>
                    <TableCell>
                      <Badge variant={c.active ? "default" : "destructive"}>
                        {c.active ? "Active" : "Suspended"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="ghost" size="sm">
                        <Link href={`/superadmin/clients/${c.id}`}>
                          Manage <ChevronRight className="ml-1 h-4 w-4" />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {clients?.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      No factories yet. Create your first one.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
