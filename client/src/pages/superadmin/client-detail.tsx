import { useState } from "react";
import { useRoute, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Loader2, ExternalLink, KeyRound, Plus, Copy } from "lucide-react";

interface AdminRow {
  id: string;
  username: string;
  name: string | null;
  role: string;
  active: boolean;
  createdAt: string;
}

interface ClientDetail {
  client: {
    id: string;
    name: string;
    slug: string;
    mode: string;
    ownerName: string | null;
    ownerWhatsapp: string | null;
    active: boolean;
  };
  admins: AdminRow[];
}

export default function SuperAdminClientDetail() {
  const [, params] = useRoute("/superadmin/clients/:id");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const id = params?.id ?? "";

  const { data, isLoading } = useQuery<ClientDetail>({
    queryKey: ["/api/superadmin/clients", id],
    enabled: !!id,
  });

  const [newAdmin, setNewAdmin] = useState({ username: "", password: "", name: "" });
  const [addOpen, setAddOpen] = useState(false);
  const [oneTime, setOneTime] = useState<{ username: string; password: string } | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/superadmin/clients", id] });

  const toggleActive = useMutation({
    mutationFn: async (active: boolean) => {
      await apiRequest("PATCH", `/api/superadmin/clients/${id}`, { active });
    },
    onSuccess: () => {
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/superadmin/clients"] });
      toast({ title: "Status updated" });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const resetPw = useMutation({
    mutationFn: async (adminId: string) => {
      const pw = `cb-${Math.abs(hashStr(adminId + Date.now().toString())).toString(36)}`;
      const res = await apiRequest("POST", `/api/superadmin/admins/${adminId}/reset-password`, {
        newPassword: pw,
      });
      return res.json() as Promise<{ username: string; password: string }>;
    },
    onSuccess: (d) => setOneTime({ username: d.username, password: d.password }),
    onError: (e: Error) => toast({ title: "Reset failed", description: e.message, variant: "destructive" }),
  });

  const addAdmin = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/superadmin/clients/${id}/admins`, {
        username: newAdmin.username,
        password: newAdmin.password,
        name: newAdmin.name || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      setOneTime({ username: newAdmin.username, password: newAdmin.password });
      setNewAdmin({ username: "", password: "", name: "" });
      setAddOpen(false);
      refresh();
    },
    onError: (e: Error) => toast({ title: "Could not add admin", description: e.message, variant: "destructive" }),
  });

  const impersonate = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/superadmin/impersonate/${id}`);
    },
    onSuccess: () => {
      // /me now reports actingClientId — refresh it, then enter the panel.
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/admin");
    },
    onError: (e: Error) => toast({ title: "Could not open panel", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!data) {
    return <p className="text-muted-foreground">Factory not found.</p>;
  }

  const { client, admins } = data;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/superadmin">
          <ArrowLeft className="mr-1 h-4 w-4" /> All factories
        </Link>
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            {client.name}
            <Badge variant={client.active ? "default" : "destructive"}>
              {client.active ? "Active" : "Suspended"}
            </Badge>
          </h1>
          <p className="font-mono text-sm text-muted-foreground">
            {client.slug} · {client.mode}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => impersonate.mutate()} disabled={impersonate.isPending}>
            {impersonate.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ExternalLink className="mr-2 h-4 w-4" />}
            Manage this factory's panel
          </Button>
          <Button
            variant={client.active ? "destructive" : "default"}
            onClick={() => toggleActive.mutate(!client.active)}
            disabled={toggleActive.isPending}
          >
            {client.active ? "Suspend" : "Reactivate"}
          </Button>
        </div>
      </div>

      {!client.active && (
        <Card className="border-destructive/40">
          <CardContent className="py-3 text-sm text-muted-foreground">
            Suspended — this factory's bot is offline (web + WhatsApp) and its admins can't log in.
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Admins</CardTitle>
            <CardDescription>Logins for this factory. Multiple allowed.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add admin
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {admins.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium">{a.name || a.username}</p>
                <p className="text-xs text-muted-foreground">
                  {a.username} · {a.role}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => resetPw.mutate(a.id)} disabled={resetPw.isPending}>
                <KeyRound className="mr-1 h-4 w-4" /> Reset password
              </Button>
            </div>
          ))}
          {admins.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">No admins.</p>
          )}
        </CardContent>
      </Card>

      {/* Add admin dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add an admin</DialogTitle>
            <DialogDescription>Creates another login for {client.name}.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label htmlFor="au">Username</Label>
              <Input id="au" value={newAdmin.username} onChange={(e) => setNewAdmin((s) => ({ ...s, username: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ap">Password</Label>
              <Input id="ap" value={newAdmin.password} onChange={(e) => setNewAdmin((s) => ({ ...s, password: e.target.value }))} placeholder="min 8 chars" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="an">Name (optional)</Label>
              <Input id="an" value={newAdmin.name} onChange={(e) => setNewAdmin((s) => ({ ...s, name: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={() => addAdmin.mutate()} disabled={addAdmin.isPending || !newAdmin.username || newAdmin.password.length < 8}>
              {addAdmin.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* One-time credentials reveal (after reset or add) */}
      <Dialog open={!!oneTime} onOpenChange={(o) => !o && setOneTime(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Credentials</DialogTitle>
            <DialogDescription>Shown once — copy and hand off now.</DialogDescription>
          </DialogHeader>
          {oneTime && (
            <div className="space-y-1 rounded-lg border bg-muted/40 p-4 font-mono text-sm">
              <div>Username: {oneTime.username}</div>
              <div>Password: {oneTime.password}</div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (oneTime) void navigator.clipboard.writeText(`Username: ${oneTime.username}\nPassword: ${oneTime.password}`);
                toast({ title: "Copied" });
              }}
            >
              <Copy className="mr-2 h-4 w-4" /> Copy
            </Button>
            <Button onClick={() => setOneTime(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Tiny deterministic string hash for generating a readable temp password.
function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return h;
}
