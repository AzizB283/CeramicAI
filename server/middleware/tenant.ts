import { AsyncLocalStorage } from "node:async_hooks";

export interface TenantContext {
  clientId: string;
}

export const tenantContext = new AsyncLocalStorage<TenantContext>();

/** "single" = one client, context optional. "multi" = SaaS, context required. */
export type TenantMode = "single" | "multi";

export function getTenantMode(): TenantMode {
  return process.env.TENANT_MODE === "multi" ? "multi" : "single";
}

/** The active client id, or undefined in single mode without a context. */
export function currentClientId(): string | undefined {
  return tenantContext.getStore()?.clientId;
}

/** Run `fn` with a bound client id (used by HTTP middleware in a later slice, and by tests). */
export function runWithClient<T>(clientId: string, fn: () => T): T {
  return tenantContext.run({ clientId }, fn);
}
