import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream px-4 text-center">
      <p className="text-6xl font-bold text-coral">404</p>
      <h1 className="text-2xl font-bold text-ink">Page not found</h1>
      <p className="max-w-sm text-sm text-ink-soft">
        The page you're looking for doesn't exist or has moved.
      </p>
      <div className="flex gap-3">
        <Link href="/">
          <Button variant="outline">Open demo</Button>
        </Link>
        <Link href="/admin">
          <Button>Go to admin</Button>
        </Link>
      </div>
    </div>
  );
}
