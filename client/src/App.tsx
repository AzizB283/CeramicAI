import { Switch, Route, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";

import { AdminLayout } from "@/components/admin-layout";
import { SuperAdminLayout } from "@/components/superadmin-layout";
import LandingPage from "@/pages/landing";
import FeaturesPage from "@/pages/features";
import AboutPage from "@/pages/about";
import DemoChat from "@/pages/demo";
import EmbedChat from "@/pages/embed-chat";
import LoginPage from "@/pages/login";
import NotFound from "@/pages/not-found";
import AdminDashboard from "@/pages/admin/dashboard";
import AdminLeads from "@/pages/admin/leads";
import AdminProducts from "@/pages/admin/products";
import AdminCatalogues from "@/pages/admin/catalogues";
import AdminChatWidget from "@/pages/admin/chat-widget";
import AdminIntegrations from "@/pages/admin/integrations";
import AdminSettings from "@/pages/admin/settings";
import SuperAdminClients from "@/pages/superadmin/clients";
import SuperAdminClientDetail from "@/pages/superadmin/client-detail";

function LoadingSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-cream">
      <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-coral" />
    </div>
  );
}

// Guards the factory /admin panel. A superadmin may only enter while
// impersonating a factory; otherwise we send them to their own panel.
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, isSuperAdmin, isImpersonating } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  if (isSuperAdmin && !isImpersonating) {
    return <Redirect to="/superadmin" />;
  }
  return <>{children}</>;
}

// Guards the /superadmin panel — superadmin role only.
function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated, isSuperAdmin } = useAuth();

  if (isLoading) {
    return <LoadingSpinner />;
  }
  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }
  if (!isSuperAdmin) {
    return <Redirect to="/admin" />;
  }
  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      {/* Public marketing site */}
      <Route path="/" component={LandingPage} />
      <Route path="/features" component={FeaturesPage} />
      <Route path="/about" component={AboutPage} />

      {/* Chatbot — gated off the public site to protect the OpenAI key.
          /demo is reachable (for in-panel/internal demos) but not linked
          from the marketing pages. /chat stays for the embeddable widget +
          iframe on factory websites (driven by ?client=<slug>). */}
      <Route path="/demo">
        <DemoChat variant="demo" />
      </Route>
      <Route path="/chat" component={EmbedChat} />
      <Route path="/login" component={LoginPage} />

      {/* Super-admin (Aurex operator — cross-tenant) */}
      <Route path="/superadmin">
        <SuperAdminRoute>
          <SuperAdminLayout>
            <SuperAdminClients />
          </SuperAdminLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/superadmin/clients/:id">
        <SuperAdminRoute>
          <SuperAdminLayout>
            <SuperAdminClientDetail />
          </SuperAdminLayout>
        </SuperAdminRoute>
      </Route>

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
      <Route path="/admin/products">
        <ProtectedRoute>
          <AdminLayout>
            <AdminProducts />
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
      <Route path="/admin/integrations">
        <ProtectedRoute>
          <AdminLayout>
            <AdminIntegrations />
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
