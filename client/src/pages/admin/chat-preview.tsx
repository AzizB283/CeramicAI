import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import DemoChat from "@/pages/demo";

export default function AdminChatPreview() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Chat Preview</h1>
          <p className="text-muted-foreground">
            Live preview of the public CeramicBot widget.
          </p>
        </div>
        <a href="/" target="_blank" rel="noreferrer">
          <Button variant="outline">
            <ExternalLink className="mr-2 h-4 w-4" />
            Open in new tab
          </Button>
        </a>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {/* Embed the real demo so it stays in sync with what buyers see. */}
          <div className="min-h-[70vh] bg-cream">
            <DemoChat />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
