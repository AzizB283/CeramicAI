import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  MessageSquare,
  Package,
  Plug,
  Settings,
  LogOut,
} from "lucide-react";

const menuItems = [
  { title: "Dashboard", url: "/admin", icon: LayoutDashboard },
  { title: "Leads", url: "/admin/leads", icon: Users },
  { title: "Products", url: "/admin/products", icon: Package },
  { title: "Catalogues", url: "/admin/catalogues", icon: BookOpen },
  { title: "Chat Widget", url: "/admin/chat-widget", icon: MessageSquare },
  { title: "Integrations", url: "/admin/integrations", icon: Plug },
  { title: "Settings", url: "/admin/settings", icon: Settings },
];

function Wordmark() {
  return (
    <span className="text-lg font-bold tracking-tight">
      Ceramic<span className="text-coral">Bot</span>
    </span>
  );
}

function ImpersonationBanner() {
  const [, navigate] = useLocation();
  const stop = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/superadmin/impersonate/stop");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/superadmin");
    },
  });
  return (
    <div className="flex items-center justify-between gap-3 bg-coral px-4 py-2 text-sm text-white">
      <span className="font-medium">
        You are managing this factory as super-admin.
      </span>
      <Button
        size="sm"
        variant="secondary"
        className="h-7"
        onClick={() => stop.mutate()}
        disabled={stop.isPending}
        data-testid="button-exit-impersonation"
      >
        Exit to super-admin
      </Button>
    </div>
  );
}

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, logout, isImpersonating } = useAuth();
  const [location] = useLocation();

  const sidebarStyle = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  } as React.CSSProperties;

  const initials = (user?.username?.[0] ?? "A").toUpperCase();

  return (
    <SidebarProvider style={sidebarStyle} className="!min-h-0 fixed inset-0 overflow-hidden">
      <div className="flex h-full w-full overflow-hidden">
        <Sidebar>
          <SidebarHeader className="p-4">
            <Link href="/admin">
              <div className="flex items-center gap-2 cursor-pointer">
                <div className="grid h-8 w-8 place-items-center rounded-md bg-coral text-white font-bold">
                  C
                </div>
                <Wordmark />
              </div>
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Management</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {menuItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.url}>
                        <Link href={item.url}>
                          <item.icon className="h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>
        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between gap-4 border-b bg-background p-4">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <Link href="/admin">
                <span className="cursor-pointer md:hidden">
                  <Wordmark />
                </span>
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    className="flex items-center gap-2 px-2"
                    data-testid="button-user-menu"
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarFallback className="bg-coral text-white">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden text-sm font-medium sm:inline">
                      {user?.username ?? "Admin"}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>
                    {user?.username ?? "Admin"}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => logout()}
                    data-testid="button-logout"
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    Log out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          {isImpersonating && <ImpersonationBanner />}
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
