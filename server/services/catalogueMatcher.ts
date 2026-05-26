import type { CeramicCatalogue } from "@shared/schema";
import type { LeadDraft, Mode } from "@shared/types";

/**
 * Pick the best-matching catalogue for a buyer's current intent.
 *
 * Score-based, deterministic, total order. The caller should fall back to the
 * client's default catalog URL (or a hardcoded placeholder) when this returns
 * undefined — that happens when no active+audience-matching catalogues exist
 * or when every candidate scored 0 (no category/size/finish overlap).
 *
 * Rules:
 *  - audience must match: 'both' is universally compatible; 'domestic' only
 *    matches factory mode; 'export' only matches exporter mode.
 *  - +10 if the catalogue's category matches the buyer's product category
 *    exactly (or the catalogue is 'mixed' — a general PDF that always
 *    half-applies; scored lower so a specific match wins).
 *  - +5 if any size in catalogue.sizes equals the buyer's productSize.
 *  - +5 if any finish in catalogue.finishes (case-insensitive) equals the
 *    buyer's productFinish.
 *  - Ties broken by displayOrder ASC (admin-set priority), then by newest
 *    createdAt — newer catalogues win when everything else is equal, since
 *    factories update designs frequently.
 *
 * Catalogues with score 0 are discarded so we don't pick something
 * unrelated to the buyer (e.g. a sanitaryware PDF for a tile inquiry).
 */
export function pickCatalogue(
  lead: LeadDraft,
  mode: Mode,
  candidates: CeramicCatalogue[],
): CeramicCatalogue | undefined {
  const audience = mode === "exporter" ? "export" : "domestic";

  const eligible = candidates.filter(
    (c) => c.isActive && (c.audience === "both" || c.audience === audience),
  );

  type Scored = { cat: CeramicCatalogue; score: number };
  const scored: Scored[] = [];

  for (const cat of eligible) {
    let categoryScore = 0;
    if (lead.productCategory && cat.category === lead.productCategory) {
      categoryScore = 10;
    } else if (cat.category === "mixed") {
      // General catalogue — half-applies for any category. Lower than an exact
      // match so specific catalogues always win when both exist.
      categoryScore = 5;
    }

    // Size/finish are only meaningful when the catalogue is the right
    // category. A GVT catalogue isn't a sanitaryware catalogue just because
    // both happen to support 600×600 — without a category match, the bonus
    // would pull in unrelated catalogues. So gate them on categoryScore > 0.
    if (categoryScore === 0) continue;

    let score = categoryScore;
    if (lead.productSize && cat.sizes.includes(lead.productSize)) {
      score += 5;
    }
    if (lead.productFinish) {
      const want = lead.productFinish.toLowerCase();
      if (cat.finishes.some((f) => f.toLowerCase() === want)) {
        score += 5;
      }
    }
    scored.push({ cat, score });
  }

  if (scored.length === 0) return undefined;

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.cat.displayOrder !== b.cat.displayOrder) {
      return a.cat.displayOrder - b.cat.displayOrder;
    }
    return new Date(b.cat.createdAt).getTime() - new Date(a.cat.createdAt).getTime();
  });

  return scored[0].cat;
}
