import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";

export type AdminRole = "superadmin" | "factory";

export interface AuthUser {
  id: string;
  username: string;
  name: string | null;
  role: AdminRole;
  clientId: string | null;
  /** Set when a superadmin is impersonating a factory's panel. */
  actingClientId: string | null;
}

/**
 * Role-aware auth for CeramicBot.
 * GET /api/auth/me returns the full identity when logged in, 401 otherwise.
 * We use getQueryFn({ on401: "returnNull" }) so a logged-out state is `null`
 * rather than a thrown error.
 */
export function useAuth() {
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthUser | null>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
    staleTime: 1000 * 60 * 5,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      window.location.href = "/login";
    },
  });

  const role = user?.role ?? null;

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
    role,
    isSuperAdmin: role === "superadmin",
    isFactoryAdmin: role === "factory",
    isImpersonating: !!user?.actingClientId,
    logout: logoutMutation.mutate,
    isLoggingOut: logoutMutation.isPending,
  };
}
