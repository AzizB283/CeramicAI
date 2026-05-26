import { Switch, Route, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";

import { AdminLayout } from "@/components/admin-layout";
import DemoChat from "@/pages/demo";
import EmbedChat from "@/pages/embed-chat";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminLeads from "@/pages/admin/leads";
import AdminCatalogues from "@/pages/admin/catalogues";
import AdminChatWidget from "@/pages/admin/chat-widget";
import AdminSettings from "@/pages/admin/settings";

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-cream">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-coral" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Public demo */}
      <Route path="/" component={DemoChat} />
      {/* Embeddable / standalone chat page (no chrome, iframe-friendly) */}
      <Route path="/chat" component={EmbedChat} />
      <Route path="/login" component={LoginPage} />

      {/* Admin (auth-gated) */}
      <Route path="/admin">
        <ProtectedRoute>
          <AdminLayout>
            <AdminDashboard />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/leads">
        <ProtectedRoute>
          <AdminLayout>
            <AdminLeads />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/catalogues">
        <ProtectedRoute>
          <AdminLayout>
            <AdminCatalogues />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/chat-widget">
        <ProtectedRoute>
          <AdminLayout>
            <AdminChatWidget />
          </AdminLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/admin/settings">
        <ProtectedRoute>
          <AdminLayout>
            <AdminSettings />
          </AdminLayout>
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
