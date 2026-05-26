import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Copy, ExternalLink, MessageSquare, Code } from "lucide-react";
import DemoChat from "@/pages/demo";

const CLIENT_SLUG = "demo"; // single-tenant for now; matches widget.js default

const FEATURES = [
  { title: "Qualify Buyers", body: "Bot identifies retailer / distributor / architect / exporter and routes the conversation accordingly." },
  { title: "Share Catalog", body: "Sends your factory or export catalog PDF the moment the buyer's product need is captured." },
  { title: "Capture Leads", body: "Buyer name, location, product, quantity, and Incoterms saved to the dashboard with PII encrypted." },
  { title: "Instant Owner Alert", body: "Distributor / exclusive-rights inquiries flag as priority and notify the owner immediately." },
];

export default function AdminChatWidget() {
  const { toast } = useToast();

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const slugAttr = ` data-client="${CLIENT_SLUG}"`;
  const slugQuery = `?client=${encodeURIComponent(CLIENT_SLUG)}`;

  const scriptCode = `<script src="${origin}/widget.js"${slugAttr} defer></script>`;
  const iframeCode = `<iframe src="${origin}/chat${slugQuery}" style="width: 400px; height: 600px; border: none; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);"></iframe>`;
  const standaloneUrl = `${origin}/chat${slugQuery}`;

  const copy = (text: string, label: string) => {
    void navigator.clipboard.writeText(text);
    toast({ title: `${label} copied to clipboard` });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Chat Widget</h1>
        <p className="text-muted-foreground">
          Preview and embed the CeramicBot chat widget on your factory or export website
        </p>
      </div>

      <Tabs defaultValue="preview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="preview">
            <MessageSquare className="h-4 w-4 mr-2" />
            Preview
          </TabsTrigger>
          <TabsTrigger value="embed">
            <Code className="h-4 w-4 mr-2" />
            Embed Code
          </TabsTrigger>
        </TabsList>

        {/* — Preview — */}
        <TabsContent value="preview">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Live Preview</CardTitle>
                <CardDescription>How the chat widget will appear on your website</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[680px] border rounded-lg overflow-y-auto">
                  <DemoChat />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
                <CardDescription>What buyers can do with the widget</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {FEATURES.map((f, i) => (
                  <div key={f.title} className="flex items-start gap-3 p-3 border rounded-lg">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-sm font-bold text-primary">{i + 1}</span>
                    </div>
                    <div>
                      <p className="font-medium">{f.title}</p>
                      <p className="text-sm text-muted-foreground">{f.body}</p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* — Embed Code — */}
        <TabsContent value="embed">
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>JavaScript Embed</CardTitle>
                <CardDescription>Add this script to your website to show the floating chat button.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg font-mono text-sm overflow-x-auto whitespace-pre-wrap break-all">
                  <code>{scriptCode}</code>
                </div>
                <Button variant="outline" onClick={() => copy(scriptCode, "Script code")}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Code
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>iFrame Embed</CardTitle>
                <CardDescription>Embed the chat widget into a specific section of your page.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="p-4 bg-muted rounded-lg font-mono text-sm overflow-x-auto whitespace-pre-wrap break-all">
                  <code>{iframeCode}</code>
                </div>
                <Button variant="outline" onClick={() => copy(iframeCode, "iFrame code")}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copy Code
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Standalone Chat Page</CardTitle>
              <CardDescription>
                A direct URL to the chat — share over WhatsApp, email, or paste in a QR code.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-4">
              <div className="p-4 bg-muted rounded-lg font-mono text-sm flex-1 min-w-0 break-all">
                <code>{standaloneUrl}</code>
              </div>
              <Button variant="outline" onClick={() => copy(standaloneUrl, "Chat URL")}>
                <Copy className="h-4 w-4 mr-2" />
                Copy URL
              </Button>
              <Button asChild>
                <a href={`/chat${slugQuery}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open
                </a>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
