/**
 * Per-factory product configuration loader.
 *
 * Translates the admin-configured `ceramic_products` rows into the
 * `ProductConfig` the flow engine consumes, so the bot offers each factory's
 * actual categories / sizes / finishes / sanitaryware items instead of the
 * hardcoded defaults in flows.ts.
 *
 * Shared by the web chat router AND the WhatsApp webhook so both channels
 * present an identical, dynamically-configured flow. Edit the mapping here —
 * don't re-implement it per channel.
 */

import type { CeramicProduct } from "@shared/schema";
import type { ProductConfig } from "@shared/flowEngine";
import { runWithClient } from "../middleware/tenant";
import { storage } from "../storage";

/** Display labels for the 6 standard categories (custom rows carry their own). */
const STANDARD_CATEGORY_LABELS: Record<string, string> = {
  ceramic_wall: "Ceramic Wall Tiles",
  gvt: "GVT / Vitrified Floor",
  pgvt: "PGVT",
  double_charge: "Double Charge",
  slab: "Slab (Large Format)",
  sanitaryware: "Sanitaryware",
};

/**
 * Build the ProductConfig the engine consumes from the rows the admin
 * configured. Returns undefined when the factory has zero active rows — the
 * engine then falls back to the hardcoded defaults in flows.ts.
 *
 * Standard categories use their slug as the key. Custom categories
 * (category="other") get a synthetic per-row key ("custom:<id>") so the
 * factory can configure multiple distinct custom categories without them
 * collapsing into one.
 */
export function buildProductConfig(rows: CeramicProduct[]): ProductConfig | undefined {
  const active = rows.filter((r) => r.isActive);
  if (active.length === 0) return undefined;
  const config: ProductConfig = {
    categories: [],
    sizesByCategory: {},
    finishesByCategory: {},
    sanitaryItems: [],
  };
  for (const row of active) {
    const isCustom = row.category === "other";
    const value = isCustom ? `custom:${row.id}` : row.category;
    const label = isCustom
      ? row.customLabel?.trim() || "Other"
      : STANDARD_CATEGORY_LABELS[row.category] ?? row.category;
    config.categories.push({ value, label });
    config.sizesByCategory[value] = row.sizes ?? [];
    config.finishesByCategory[value] = row.finishes ?? [];
    if (row.category === "sanitaryware") {
      config.sanitaryItems = row.subItems ?? [];
    }
  }
  return config;
}

/** Load + build the ProductConfig for a tenant. */
export async function resolveProductConfig(
  clientId: string,
): Promise<ProductConfig | undefined> {
  const rows = await runWithClient(clientId, () => storage.getProducts());
  return buildProductConfig(rows);
}
