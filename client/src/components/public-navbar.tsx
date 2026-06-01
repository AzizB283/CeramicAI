import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Features", href: "/features" },
  { label: "About", href: "/about" },
];

function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight text-ink">
      Ceramic<span className="text-coral">Bot</span>
    </span>
  );
}

export function PublicNavbar() {
  const [location] = useLocation();
  const [open, setOpen] = useState(false);

  return (
    <nav className="fixed inset-x-0 top-0 z-50 border-b border-ink/10 bg-cream/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/">
          <div className="flex cursor-pointer items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-md bg-coral font-bold text-white">
              C
            </div>
            <Wordmark />
          </div>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href}>
              <span
                className={cn(
                  "cursor-pointer rounded-md px-3 py-2 text-sm font-medium transition",
                  location === item.href
                    ? "text-coral-dark"
                    : "text-ink-soft hover:text-ink",
                )}
              >
                {item.label}
              </span>
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link href="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/about">Book a demo</Link>
          </Button>
          <button
            className="md:hidden"
            onClick={() => setOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-ink/10 bg-cream px-4 py-3 md:hidden">
          <div className="flex flex-col gap-1">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href}>
                <span
                  className="block cursor-pointer rounded-md px-3 py-2 text-sm font-medium text-ink-soft hover:text-ink"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </span>
              </Link>
            ))}
            <div className="mt-2 flex gap-2">
              <Button asChild variant="outline" size="sm" className="flex-1">
                <Link href="/login">Sign in</Link>
              </Button>
              <Button asChild size="sm" className="flex-1">
                <Link href="/about">Book a demo</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
