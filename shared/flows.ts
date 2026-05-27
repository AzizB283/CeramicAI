/**
 * Hardcoded conversation flows for the CeramicBot demo (Phase 1).
 *
 * Transcribed directly from CeramicBot Build Spec §3 (Conversation Flows).
 * Each `FlowStep` is one turn: the bot speaks, then the user answers via chips
 * or free text, and we advance to `next` (or the chip's own `next`).
 *
 * Step ids match the FSM state names in the spec so this file doubles as the
 * flow contract for the Phase 2 backend (see CLAUDE.md → "clinic-connect map").
 */

import type { FlowStep, Mode, StepId } from "./types";

// ── Factory Mode — domestic buyer flow (spec §3.1) ──────────────────────────
const FACTORY_STEPS: FlowStep[] = [
  {
    id: "f_welcome",
    bot: [
      "Welcome to {client} — Ceramic Tiles Manufacturer, Morbi 🏭",
      "Who are you? Please select:",
    ],
    input: "choice",
    field: "buyerType",
    next: "f_product",
    options: [
      { label: "Retailer / Tile Shop Owner", value: "retailer" },
      { label: "Distributor / Wholesaler", value: "distributor" },
      { label: "Architect / Interior Designer", value: "architect" },
      { label: "Builder / Developer", value: "builder" },
      { label: "Export Buyer (International)", value: "export" },
      { label: "General Inquiry", value: "general" },
    ],
  },
  {
    id: "f_product",
    bot: ["What product are you looking for?"],
    input: "choice",
    field: "productCategory",
    next: "f_size",
    options: [
      { label: "Ceramic Wall Tiles", value: "ceramic_wall" },
      { label: "GVT / Vitrified Floor Tiles", value: "gvt" },
      { label: "PGVT (Polished Glazed Vitrified)", value: "pgvt" },
      { label: "Double Charge Tiles", value: "double_charge" },
      { label: "Slab Tiles (Large Format)", value: "slab" },
      { label: "Sanitaryware", value: "sanitaryware" },
      { label: "Other / Not sure", value: "other" },
    ],
  },
  {
    id: "f_sani_item",
    bot: ["Which sanitaryware item are you looking for?"],
    input: "choice",
    field: "sanitaryItem",
    next: "f_quantity",
    options: [
      { label: "One-piece toilet" },
      { label: "Two-piece toilet" },
      { label: "Wash basin (counter)" },
      { label: "Wash basin (pedestal)" },
      { label: "Wash basin (wall-hung)" },
      { label: "Urinal" },
      { label: "Cistern" },
      { label: "Bidet" },
      { label: "Other / Not sure" },
    ],
  },
  {
    id: "f_size",
    bot: ["What size do you need?"],
    input: "choice",
    field: "productSize",
    next: "f_finish",
    options: [
      { label: "300×600" },
      { label: "600×600" },
      { label: "800×800" },
      { label: "1200×600" },
      { label: "1200×1200" },
      { label: "Other" },
    ],
  },
  {
    id: "f_finish",
    bot: ["Finish preference?"],
    input: "choice",
    field: "productFinish",
    next: "f_quantity",
    options: [
      { label: "Glossy" },
      { label: "Matte" },
      { label: "Sugar" },
      { label: "Carving" },
      { label: "Natural Look" },
      { label: "No preference" },
    ],
  },
  {
    id: "f_quantity",
    bot: ["Approximate monthly requirement?"],
    input: "choice",
    field: "quantity",
    next: "f_catalog",
    options: [
      { label: "Below 500 boxes" },
      { label: "500–2,000 boxes" },
      { label: "2,000–10,000 boxes" },
      { label: "10,000+ boxes" },
    ],
  },
  {
    id: "f_catalog",
    bot: [
      "Here is our latest product catalog 👇",
      "Our team will contact you shortly with pricing.",
      "May I have your name?",
    ],
    catalog: "factory",
    input: "text",
    field: "buyerName",
    placeholder: "Type your name…",
    next: "f_city",
  },
  {
    id: "f_city",
    bot: ["And which city are you in?"],
    input: "text",
    field: "buyerCity",
    placeholder: "Type your city…",
    next: "f_done",
  },
  {
    id: "f_done",
    bot: [
      "Thank you, {name}! Our sales team will reach you on this WhatsApp number within 2 hours.",
    ],
    input: "choice",
    terminal: true,
    options: [{ label: "Start over", next: "f_welcome" }],
  },
];

// ── Exporter Mode — international buyer flow (spec §3.2) ─────────────────────
const EXPORTER_STEPS: FlowStep[] = [
  {
    id: "x_welcome",
    bot: [
      "Welcome to {client} — Ceramic Tile Exporters, Morbi India 🇮🇳",
      "How can we help you today?",
    ],
    input: "choice",
    field: "intent",
    options: [
      { label: "I need a product / price quote", value: "quote", next: "x_product" },
      { label: "I want to see your catalog / price list", value: "catalog", next: "x_catalog" },
      { label: "I need samples before ordering", value: "samples", next: "x_sample_product" },
      { label: "Query about an existing order / shipment", value: "order_query", next: "x_name" },
      {
        label: "I want to become a regular buyer / distributor",
        value: "distributor",
        next: "x_dist_country",
        priority: true,
      },
    ],
  },

  // — Option 1: product / quote —
  {
    id: "x_product",
    bot: ["Which product category?"],
    input: "choice",
    field: "productCategory",
    next: "x_spec",
    options: [
      { label: "Ceramic Wall", value: "ceramic_wall" },
      { label: "GVT Vitrified", value: "gvt" },
      { label: "PGVT", value: "pgvt" },
      { label: "Double Charge", value: "double_charge" },
      { label: "Slab", value: "slab" },
      { label: "Sanitaryware", value: "sanitaryware" },
    ],
  },
  {
    id: "x_sani_item",
    bot: ["Which sanitaryware item are you looking for?"],
    input: "choice",
    field: "sanitaryItem",
    next: "x_quantity",
    options: [
      { label: "One-piece toilet" },
      { label: "Two-piece toilet" },
      { label: "Wash basin (counter)" },
      { label: "Wash basin (pedestal)" },
      { label: "Wash basin (wall-hung)" },
      { label: "Urinal" },
      { label: "Cistern" },
      { label: "Bidet" },
      { label: "Other / Not sure" },
    ],
  },
  {
    id: "x_spec",
    bot: ["What size and finish are you looking for?"],
    input: "text",
    field: "productSize",
    placeholder: "e.g. 600×600 matte…",
    next: "x_quantity",
  },
  {
    id: "x_quantity",
    bot: ["How many containers approximately?"],
    input: "choice",
    field: "quantity",
    next: "x_country",
    options: [
      { label: "1 container (20ft)" },
      { label: "2–5 containers" },
      { label: "5–10 containers" },
      { label: "10+ containers" },
    ],
  },
  {
    id: "x_country",
    bot: ["Which country are you importing to?"],
    input: "text",
    field: "country",
    placeholder: "Country name…",
    next: "x_incoterms",
  },
  {
    id: "x_incoterms",
    bot: ["Pricing preference?"],
    input: "choice",
    field: "incoterms",
    next: "x_catalog",
    options: [
      { label: "FOB Mundra", value: "FOB" },
      { label: "CIF (destination port)", value: "CIF" },
      { label: "Ex-Works", value: "EXW" },
    ],
  },
  {
    id: "x_catalog",
    bot: [
      "Here is our export catalog with current specifications 👇",
      "Our export manager will send you a formal quote within 4 hours.",
      "May I have your name?",
    ],
    catalog: "export",
    input: "text",
    field: "buyerName",
    placeholder: "Type your name…",
    next: "x_company",
  },
  {
    id: "x_company",
    bot: ["And your company name?"],
    input: "text",
    field: "buyerCompany",
    placeholder: "Company name…",
    next: "x_done",
  },
  {
    id: "x_done",
    bot: ["Thank you, {name}. We will contact you on this number shortly."],
    input: "choice",
    terminal: true,
    options: [{ label: "Start over", next: "x_welcome" }],
  },

  // — Option 3: sample request (spec §3.2 Step 4) —
  {
    id: "x_sample_product",
    bot: ["Which product would you like samples of?"],
    input: "text",
    field: "sampleProduct",
    placeholder: "Product name…",
    next: "x_sample_qty",
  },
  {
    id: "x_sample_qty",
    bot: ["How many sample pieces do you need?"],
    input: "text",
    field: "sampleQty",
    placeholder: "e.g. 5 pieces…",
    next: "x_sample_address",
  },
  {
    id: "x_sample_address",
    bot: ["Please share your courier delivery address."],
    input: "text",
    field: "sampleAddress",
    placeholder: "Full delivery address…",
    next: "x_sample_courier",
  },
  {
    id: "x_sample_courier",
    bot: ["Do you have a preferred courier?"],
    input: "choice",
    field: "courier",
    next: "x_sample_done",
    options: [{ label: "DHL" }, { label: "FedEx" }, { label: "Local" }],
  },
  {
    id: "x_sample_done",
    bot: [
      "Our team will confirm sample availability and courier cost within 24 hours.",
    ],
    input: "choice",
    terminal: true,
    options: [{ label: "Start over", next: "x_welcome" }],
  },

  // — Option 5: distributor inquiry — HIGH VALUE (spec §3.2 Step 5) —
  {
    id: "x_dist_country",
    bot: [
      "Great — we are always looking for strong distribution partners.",
      "Which country are you based in?",
    ],
    input: "text",
    field: "distributorCountry",
    placeholder: "Country…",
    next: "x_dist_imports",
  },
  {
    id: "x_dist_imports",
    bot: ["Do you currently import tiles from India or other countries?"],
    input: "choice",
    field: "importsToday",
    next: "x_dist_volume",
    options: [
      { label: "Yes, from India" },
      { label: "Yes, from other countries" },
      { label: "No, not yet" },
    ],
  },
  {
    id: "x_dist_volume",
    bot: ["What is your approximate annual tile import volume?"],
    input: "choice",
    field: "annualVolume",
    next: "x_dist_exclusive",
    options: [
      { label: "Under 50 containers" },
      { label: "50–200 containers" },
      { label: "200–1,000 containers" },
      { label: "1,000+ containers" },
    ],
  },
  {
    id: "x_dist_exclusive",
    bot: ["Are you looking for exclusive distribution rights in your region?"],
    input: "choice",
    field: "exclusiveRights",
    next: "x_dist_done",
    options: [
      { label: "Yes", value: "YES", priority: true },
      { label: "No", value: "NO" },
      { label: "Open to discuss", value: "MAYBE" },
    ],
  },
  {
    id: "x_dist_done",
    bot: [
      "Our director will personally call you within 24 hours to discuss partnership.",
    ],
    input: "choice",
    terminal: true,
    options: [{ label: "Start over", next: "x_welcome" }],
  },
];

/** Lookup table: every step by id, across both modes. */
export const STEPS: Record<StepId, FlowStep> = Object.fromEntries(
  [...FACTORY_STEPS, ...EXPORTER_STEPS].map((s) => [s.id, s]),
) as Record<StepId, FlowStep>;

/** First step for each mode. */
export const ENTRY: Record<Mode, StepId> = {
  factory: "f_welcome",
  exporter: "x_welcome",
};

/** Demo client names shown in the welcome message per mode. */
export const DEMO_CLIENT_NAME: Record<Mode, string> = {
  factory: "Shree Tiles Pvt Ltd",
  exporter: "Morbi Ceramic Exports",
};

/** Placeholder catalog links (swap for real per-client URLs in Phase 2). */
export const CATALOG_URL: Record<"factory" | "export", string> = {
  factory: "https://aurexauto.com/demo/catalog-factory.pdf",
  export: "https://aurexauto.com/demo/catalog-export.pdf",
};
