import type { StepId } from "@shared/types";

/**
 * Per-step "intent" labels: one short instruction telling the LLM what the
 * bot should accomplish at this turn. Combined with the system prompt and the
 * available chip labels, this is what produces the bot's reply.
 *
 * Why not just feed the LLM the spec's bot copy verbatim? Because the spec's
 * copy is rigid. By describing intent, the LLM can adapt phrasing to
 * conversation context — acknowledging the buyer's last message, switching
 * languages if they wrote in Hindi/Gujarati, etc. — while still hitting the
 * same FSM checkpoints. The deterministic flow still drives transitions; the
 * LLM only narrates.
 *
 * Each intent must be FOCUSED on a single step. Don't smuggle next-step
 * questions in. Don't promise prices or lead times (spec §7 rules).
 */
export const STEP_INTENTS: Record<StepId, string> = {
  // ── Factory mode (domestic buyer) ──────────────────────────────────
  f_welcome:
    "Greet the buyer warmly (mention {client} is a ceramic tile manufacturer in Morbi). Ask what type of buyer they are. They'll pick from the chips shown.",
  f_product:
    "Acknowledge their buyer type briefly. Ask which product category they're looking for. Chips list the categories.",
  f_sani_item:
    "Acknowledge they picked sanitaryware. Ask which item they're looking for — chips list toilets, wash basins, urinal, cistern, bidet, etc. No size question for sanitaryware.",
  f_size:
    "Ask what tile size they need. Chips list standard sizes (300×600 up to 1200×1200).",
  f_finish:
    "Ask their finish preference (glossy, matte, sugar, carving, natural look, or no preference).",
  f_quantity:
    "Ask their approximate monthly requirement in boxes. Chips list volume ranges.",
  f_catalog:
    "Confirm what they're looking for in 1 short line. Say the product catalogue is below (the UI shows it). Mention the sales team will share pricing. Ask for their name. Keep this to 2–3 short messages.",
  f_name:
    "Ask the buyer for their name (free text). Used by the 'order query' branch where the catalog step is skipped.",
  f_city:
    "Thank them by name. Ask which city they're in.",
  f_done:
    "Thank them by name. Confirm the sales team will contact them on WhatsApp within 2 hours. Friendly closing. One short message.",

  // ── Exporter mode (international buyer) ────────────────────────────
  x_welcome:
    "Greet the international buyer warmly (mention {client} is a Morbi-based ceramic tile exporter). Ask how you can help — chips list the 5 paths (quote / catalogue / samples / order query / become a distributor).",
  x_product:
    "Acknowledge their intent briefly. Ask which product category — chips list the export categories.",
  x_sani_item:
    "Acknowledge they picked sanitaryware. Ask which item — chips list toilets, wash basins, urinal, cistern, bidet. Skip the size question for sanitaryware.",
  x_spec:
    "Ask what size and finish they're looking for. They'll type a free-text answer.",
  x_quantity:
    "Ask roughly how many containers — chips list ranges (1 / 2–5 / 5–10 / 10+).",
  x_country:
    "Ask which country they're importing to. They'll type the country.",
  x_incoterms:
    "Ask their pricing preference — chips show FOB Mundra, CIF [destination port], Ex-Works.",
  x_catalog:
    "Confirm what they're after in 1 line. Say the export catalogue is below and the export manager will send a formal quote within 4 hours. Ask for their name. 2–3 short messages.",
  x_name:
    "Ask the international buyer for their name (free text). Used by the 'order query' branch.",
  x_company:
    "Thank them by name. Ask for their company name.",
  x_done:
    "Thank them by name and company. Confirm follow-up shortly. One short message.",

  // ── Exporter sample-request branch ─────────────────────────────────
  x_sample_product:
    "Acknowledge they want samples. Ask which product they'd like samples of (free text).",
  x_sample_qty:
    "Ask how many sample pieces they need (free text — could be '5 pieces' or '1 set of each design').",
  x_sample_address:
    "Ask for their courier delivery address (free text).",
  x_sample_courier:
    "Ask if they have a preferred courier — chips: DHL, FedEx, Local.",
  x_sample_done:
    "Confirm the team will verify sample availability and courier cost within 24 hours. One short friendly closing.",

  // ── Exporter distributor branch — PRIORITY path ────────────────────
  x_dist_country:
    "Excited but professional — say {client} is always looking for strong distribution partners. Ask which country they're based in (free text).",
  x_dist_imports:
    "Ask whether they currently import tiles from India or other countries. Chips: yes from India / yes from other countries / no, not yet.",
  x_dist_volume:
    "Ask their approximate annual tile import volume. Chips: <50, 50–200, 200–1000, 1000+ containers.",
  x_dist_exclusive:
    "Ask if they're looking for exclusive distribution rights in their region. Chips: Yes / No / Open to discuss.",
  x_dist_done:
    "Strong closing: confirm the director will personally call them within 24 hours to discuss partnership. One short, warm message.",
};

/**
 * Steps where the LLM should produce multiple short bubbles (≥ 2). Most
 * steps want a single concise message; these are exceptions where the spec
 * specifically renders multi-line copy (welcome screens, catalog handoff).
 */
export const MULTI_BUBBLE_STEPS = new Set<StepId>([
  "f_welcome",
  "x_welcome",
  "f_catalog",
  "x_catalog",
]);
