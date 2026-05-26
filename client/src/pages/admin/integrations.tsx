import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Copy, MessageCircle, CheckCircle2, AlertTriangle } from "lucide-react";

/**
 * Per-factory WhatsApp Business Cloud API setup.
 *
 * The factory pastes the four values Meta gives them after creating a
 * WhatsApp Business app — phone number id, access token, verify token,
 * app secret — and we wire them up so the bot can receive + reply on
 * their WhatsApp number. The webhook URL we show is the one they need
 * to paste back into Meta.
 */

interface WhatsAppConfig {
  slug: string;
  waPhoneId: string | null;
  waVerifyToken: string | null;
  waTokenConfigured: boolean;
  waAppSecretConfigured: boolean;
  webhookUrl: string;
}

interface TestResult {
  ok: boolean;
  problems: string[];
}

export default function AdminIntegrations() {
  const { toast } = useToast();
  const { data: config, isLoading } = useQuery<WhatsAppConfig>({
    queryKey: ["/api/admin/whatsapp"],
  });

  // Local form state. Secrets are write-only — never read back from the
  // server. We show "*** configured" badges instead of values for those.
  const [phoneId, setPhoneId] = useState("");
  const [verifyToken, setVerifyToken] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [appSecret, setAppSecret] = useState("");

  // Seed the public fields from the server config when it loads. Secrets
  // stay blank so the user has to deliberately type them in to update.
  useEffect(() => {
    if (!config) return;
    setPhoneId(config.waPhoneId ?? "");
    setVerifyToken(config.waVerifyToken ?? "");
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, string> = {
        waPhoneId: phoneId,
        waVerifyToken: verifyToken,
      };
      // Only send secrets if the user actually entered something new.
      if (accessToken.trim()) body.waToken = accessToken.trim();
      if (appSecret.trim()) body.waAppSecret = appSecret.trim();
      const res = await apiRequest("PATCH", "/api/admin/whatsapp", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/whatsapp"] });
      setAccessToken("");
      setAppSecret("");
      toast({ title: "WhatsApp config saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/whatsapp/test", {});
      return res.json() as Promise<TestResult>;
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast({ title: "WhatsApp config looks good", description: "All four credentials present and decryptable." });
      } else {
        toast({
          title: "Configuration incomplete",
          description: result.problems.join("; "),
          variant: "destructive",
        });
      }
    },
  });

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast({ title: `${label} copied` });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Integrations</h1>
          <p className="text-muted-foreground">Connect external services like WhatsApp Business</p>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const fullyConfigured =
    config?.waPhoneId &&
    config?.waVerifyToken &&
    config?.waTokenConfigured &&
    config?.waAppSecretConfigured;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Integrations</h1>
        <p className="text-muted-foreground">
          Connect external services so CeramicBot can answer buyers everywhere they message you.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-green-500/15 text-green-600">
                <MessageCircle className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>WhatsApp Business</CardTitle>
                <CardDescription>Meta Cloud API — receive + reply on a real WhatsApp number.</CardDescription>
              </div>
            </div>
            {fullyConfigured ? (
              <Badge className="bg-green-500/15 text-green-700 border-green-500/30">
                <CheckCircle2 className="h-3 w-3 mr-1" /> Configured
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Not configured
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Webhook URL — copy this into the Meta dashboard. */}
          <div className="space-y-2">
            <Label>1. Webhook URL (paste into Meta → WhatsApp → Configuration)</Label>
            <div className="flex gap-2">
              <Input value={config?.webhookUrl ?? ""} readOnly className="font-mono text-xs" />
              <Button
                variant="outline"
                size="icon"
                onClick={() => copy(config?.webhookUrl ?? "", "Webhook URL")}
                aria-label="Copy webhook URL"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Subscribe to the <code className="text-foreground">messages</code> event in Meta.
            </p>
          </div>

          {/* Verify token — public-ish; the factory chooses any random string. */}
          <div className="space-y-2">
            <Label htmlFor="verifyToken">2. Verify Token</Label>
            <Input
              id="verifyToken"
              placeholder="Pick any random string — Meta asks for this to verify the webhook"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Use the same value here AND in Meta's webhook configuration. We compare them on the
              GET handshake.
            </p>
          </div>

          {/* Phone number id — public-ish; visible in Meta dashboard. */}
          <div className="space-y-2">
            <Label htmlFor="phoneId">3. Phone Number ID</Label>
            <Input
              id="phoneId"
              placeholder="e.g. 109876543210987"
              value={phoneId}
              onChange={(e) => setPhoneId(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              From Meta → WhatsApp → API Setup. NOT your phone number itself.
            </p>
          </div>

          {/* Access token — SECRET. */}
          <div className="space-y-2">
            <Label htmlFor="token" className="flex items-center gap-2">
              4. Access Token
              {config?.waTokenConfigured && (
                <Badge variant="outline" className="text-xs">stored — leave blank to keep</Badge>
              )}
            </Label>
            <Input
              id="token"
              type="password"
              placeholder={
                config?.waTokenConfigured
                  ? "•••• already stored — paste a new value only to replace"
                  : "Paste the permanent access token from Meta"
              }
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Encrypted at rest. Generate a permanent token in Meta → System Users (24-hour temp
              tokens will silently expire — don't use them in production).
            </p>
          </div>

          {/* App secret — SECRET. */}
          <div className="space-y-2">
            <Label htmlFor="appSecret" className="flex items-center gap-2">
              5. App Secret
              {config?.waAppSecretConfigured && (
                <Badge variant="outline" className="text-xs">stored — leave blank to keep</Badge>
              )}
            </Label>
            <Input
              id="appSecret"
              type="password"
              placeholder={
                config?.waAppSecretConfigured
                  ? "•••• already stored — paste a new value only to replace"
                  : "Paste the App Secret from Meta → App Settings → Basic"
              }
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Encrypted at rest. Used to verify Meta's signature on inbound messages so nobody else
              can hit the webhook with fake data.
            </p>
          </div>

          {/* Save + Test */}
          <div className="flex flex-wrap gap-3 pt-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : "Save WhatsApp Config"}
            </Button>
            <Button
              variant="outline"
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending || !fullyConfigured}
            >
              {testMutation.isPending ? "Checking…" : "Test Config"}
            </Button>
          </div>

          {/* Helpful next step */}
          {!fullyConfigured && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>One more step</AlertTitle>
              <AlertDescription>
                After saving all four fields, paste the Webhook URL above into Meta's WhatsApp →
                Configuration screen, use your Verify Token, and subscribe to{" "}
                <code>messages</code>. See <code>docs/whatsapp-setup.md</code> for the full guide.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
