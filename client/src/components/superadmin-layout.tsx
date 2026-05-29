import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { LogOut, Shield } from "lucide-react";

export function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/superadmin">
            <div className="flex cursor-pointer items-center gap-2">
              <div className="grid h-8 w-8 place-items-center rounded-md bg-coral text-white">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <span className="font-bold">
                  Ceramic<span className="text-coral">Bot</span>
                </span>
                <span className="ml-2 text-xs text-muted-foreground">Super Admin</span>
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-muted-foreground sm:inline">
              {user?.name || user?.username}
            </span>
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => logout()}
              data-testid="button-logout"
              aria-label="Log out"
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
