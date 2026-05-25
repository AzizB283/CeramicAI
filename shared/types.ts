/**
 * Core types for the CeramicBot demo state machine.
 *
 * Phase 1 is frontend-only: the "conversation" is a deterministic walk through
 * a hardcoded flow graph. Each step shows a bot message + a set of options.
 * When the user picks an option (or types free text), we move to the next step.
 *
 * Phase 2 (real WhatsApp bot) replaces this graph with the LLM-driven FSM from
 * clinic-connect (engine.ts / dialogueState.ts). The step IDs below map 1:1 to
 * the FSM states named in the build spec, so the demo doubles as a flow spec.
 */

export type Mode = "factory" | "exporter";

/** Message bubbles rendered in the chat thread. */
export type ChatRole = "bot" | "user";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
}

/** How the user answers the current step. */
export type InputKind =
  | "choice" // tap one of the quick-reply chips
  | "multi" // (reserved) multi-select chips
  | "text"; // free-text entry (name, city, country, address...)

export interface QuickReply {
  /** Label shown on the chip. */
  label: string;
  /** Step id to advance to when chosen. Defaults to the step's `next`. */
  next?: StepId;
  /** Stored on the lead under this key when chosen. */
  field?: keyof LeadDraft;
  /** Value stored for `field` (defaults to `label`). */
  value?: string;
  /** Marks this choice as a priority/high-value path (distributor). */
  priority?: boolean;
}

export interface FlowStep {
  id: StepId;
  /** Bot message(s). Multiple = sent as consecutive bubbles. */
  bot: string[];
  input: InputKind;
  /** For `choice` steps. */
  options?: QuickReply[];
  /** For `text` steps: where to store the typed value, and where to go next. */
  field?: keyof LeadDraft;
  placeholder?: string;
  next?: StepId;
  /** Renders a catalog link button before the input. */
  catalog?: "factory" | "export";
  /** Terminal step — fire the owner-alert simulation. */
  terminal?: boolean;
}

/** The lead we accumulate as the user walks the flow (mirrors ceramic_leads). */
export interface LeadDraft {
  buyerType?: string;
  productCategory?: string;
  productSize?: string;
  productFinish?: string;
  quantity?: string;
  intent?: string;
  country?: string;
  incoterms?: string;
  sampleProduct?: string;
  sampleQty?: string;
  sampleAddress?: string;
  courier?: string;
  distributorCountry?: string;
  importsToday?: string;
  annualVolume?: string;
  exclusiveRights?: string;
  buyerName?: string;
  buyerCity?: string;
  buyerCompany?: string;
  priority?: "normal" | "high" | "priority";
}

/**
 * Step ids. These intentionally match the FSM state names in the spec
 * (BUYER_TYPE, PRODUCT, SIZE, QUANTITY, LEAD_CAPTURE, DISTRIBUTOR, ...).
 */
export type StepId =
  // factory mode
  | "f_welcome"
  | "f_product"
  | "f_size"
  | "f_finish"
  | "f_quantity"
  | "f_catalog"
  | "f_name"
  | "f_city"
  | "f_done"
  // exporter mode
  | "x_welcome"
  | "x_product"
  | "x_spec"
  | "x_quantity"
  | "x_country"
  | "x_incoterms"
  | "x_catalog"
  | "x_name"
  | "x_company"
  | "x_done"
  // exporter — sample request branch
  | "x_sample_product"
  | "x_sample_qty"
  | "x_sample_address"
  | "x_sample_courier"
  | "x_sample_done"
  // exporter — distributor branch (priority)
  | "x_dist_country"
  | "x_dist_imports"
  | "x_dist_volume"
  | "x_dist_exclusive"
  | "x_dist_done";
