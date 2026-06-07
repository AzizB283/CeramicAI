/**
 * CSV import for the outbound address book.
 *
 * Deliberately dependency-free (matches the repo's Resend/keep-alive ethos): a
 * small RFC-4180 parser handles quoted fields, embedded commas, and embedded
 * newlines — enough for the exporter CSVs we see (IndiaMART / Alibaba /
 * TradeIndia exports + hand-built sheets). No streaming: these lists are
 * thousands of rows at most, comfortably in memory.
 *
 * Pipeline: parse → detect/apply a column preset → map each row to a contact
 * draft → validate (must have at least an email or phone) → return drafts +
 * per-row errors. Persistence + dedupe happens in the route via storage; this
 * module is pure (no DB) so it's trivially unit-testable.
 */
import type {
  ContactField,
  CsvColumnMap,
  CsvPreset,
  CsvRowError,
  InputContactDraft,
} from "@shared/types";

// ── RFC-4180-ish parser ─────────────────────────────────────────────────
/** Parse CSV text into a matrix of string cells. Handles "quoted, fields",
 *  "embedded ""quotes""", and newlines inside quotes. Strips a UTF-8 BOM. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip BOM that Excel loves to prepend.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // swallow — handled by the \n branch (or trailing CR at EOF)
    } else {
      field += c;
    }
  }
  // flush the final field/row (no trailing newline)
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    out.push(row);
  }
  // drop fully-empty trailing rows
  return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

// ── header normalisation + presets ──────────────────────────────────────
function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

// Each preset maps a set of normalised source headers → our canonical field.
// Keys are normalised (lowercase, single-spaced).
//
// IMPORTANT: presets are auto-DETECTED by counting how many of a file's headers
// appear in `signatureHeaders` — these must be DISTINCTIVE to the platform
// (e.g. "sender email", "tel/phone"), never generic words like "email"/"name"
// that any hand-built sheet has, or every CSV would falsely match a platform.
// The full `map` (used once a preset is chosen) may include generic aliases.
interface PresetDef {
  signatureHeaders: string[]; // distinctive — drive detection
  map: Record<string, ContactField>; // full alias map — drive column mapping
}

const PRESETS: Record<Exclude<CsvPreset, "generic">, PresetDef> = {
  indiamart: {
    signatureHeaders: ["sender name", "sender email", "sender mobile", "sender company", "buyer mobile"],
    map: {
      "buyer name": "name",
      "contact person": "name",
      "sender name": "name",
      "sender email": "email",
      "buyer email": "email",
      email: "email",
      "sender mobile": "phone",
      "buyer mobile": "phone",
      "mobile no": "phone",
      "buyer company": "company",
      "company name": "company",
      "sender company": "company",
      "buyer city": "city",
      city: "city",
      "buyer state": "country", // IndiaMART is domestic; map state→region-ish
      country: "country",
      "product name": "notes",
      requirement: "notes",
    },
  },
  alibaba: {
    signatureHeaders: ["tel/phone", "country/region", "product/inquiry"],
    map: {
      "contact name": "name",
      name: "name",
      email: "email",
      "email address": "email",
      "tel/phone": "phone",
      phone: "phone",
      tel: "phone",
      company: "company",
      "company name": "company",
      country: "country",
      "country/region": "country",
      city: "city",
      "product/inquiry": "notes",
      message: "notes",
    },
  },
  tradeindia: {
    signatureHeaders: ["email id", "mobile number", "product required"],
    map: {
      "buyer name": "name",
      name: "name",
      "email id": "email",
      email: "email",
      "mobile number": "phone",
      mobile: "phone",
      phone: "phone",
      company: "company",
      "company name": "company",
      city: "city",
      country: "country",
      "product required": "notes",
    },
  },
};

// Generic auto-map: guess our canonical field from a header by keyword.
function guessField(normalised: string): ContactField | null {
  const h = normalised;
  if (/(^|\b)(e[- ]?mail)\b/.test(h)) return "email";
  if (/(mobile|phone|tel|whatsapp|contact no)/.test(h)) return "phone";
  if (/(company|firm|business|organisation|organization)/.test(h)) return "company";
  if (/(country|nation|region)/.test(h)) return "country";
  if (/(city|town)/.test(h)) return "city";
  if (/(buyer type|category|segment)/.test(h)) return "buyerType";
  if (/(tag|label)/.test(h)) return "tags";
  if (/(note|remark|requirement|message|product)/.test(h)) return "notes";
  if (/(name|contact person|person)/.test(h)) return "name";
  return null;
}

/** Detect which preset best matches a header row, using DISTINCTIVE signature
 *  headers only. Returns "generic" unless a platform's signature appears at
 *  least twice (one shared header isn't enough to claim a platform). */
export function detectPreset(headers: string[]): CsvPreset {
  const norm = new Set(headers.map(normHeader));
  let best: { preset: CsvPreset; score: number } = { preset: "generic", score: 0 };
  for (const preset of Object.keys(PRESETS) as Array<Exclude<CsvPreset, "generic">>) {
    const score = PRESETS[preset].signatureHeaders.filter((h) => norm.has(h)).length;
    if (score > best.score) best = { preset, score };
  }
  return best.score >= 2 ? best.preset : "generic";
}

/** Build the column map (header → canonical field | null) for a preset.
 *  Preset aliases win; generic keyword guessing fills the rest. */
export function buildColumnMap(headers: string[], preset: CsvPreset): CsvColumnMap {
  const map: CsvColumnMap = {};
  const presetMap = preset === "generic" ? null : PRESETS[preset].map;
  for (const header of headers) {
    const norm = normHeader(header);
    map[header] = presetMap?.[norm] ?? guessField(norm);
  }
  return map;
}

// ── row → contact draft ─────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanPhone(raw: string): string {
  // Keep digits and a single leading +; strip separators.
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+") ? "+" : "";
  return plus + trimmed.replace(/[^\d]/g, "");
}

export interface ParseImportResult {
  preset: CsvPreset;
  columnMap: CsvColumnMap;
  drafts: InputContactDraft[]; // one per valid row (pre-dedupe)
  errors: CsvRowError[];
  rowsTotal: number;
}

export interface ParseImportOptions {
  /** Force a preset instead of auto-detecting (from the wizard). */
  preset?: CsvPreset;
  /** Override the auto-built column map (user adjusted it in the wizard). */
  columnMap?: CsvColumnMap;
  /** Default source stamped on every contact (defaults to the preset, else "csv"). */
  source?: string;
}

/**
 * Parse raw CSV text into validated contact drafts. Pure: returns drafts +
 * errors; the caller persists + dedupes. A row is rejected (and reported) if
 * it has neither a valid email nor a phone — we can't contact it.
 */
export function parseContactsCsv(text: string, opts: ParseImportOptions = {}): ParseImportResult {
  const matrix = parseCsv(text);
  if (matrix.length === 0) {
    return { preset: "generic", columnMap: {}, drafts: [], errors: [], rowsTotal: 0 };
  }
  const headers = matrix[0];
  const preset = opts.preset ?? detectPreset(headers);
  const columnMap = opts.columnMap ?? buildColumnMap(headers, preset);
  const source = opts.source ?? (preset === "generic" ? "csv" : preset);

  const drafts: InputContactDraft[] = [];
  const errors: CsvRowError[] = [];
  const dataRows = matrix.slice(1);

  dataRows.forEach((cells, idx) => {
    const rowNum = idx + 1; // 1-based, excluding header
    const draft: InputContactDraft = { source };
    let rawTags = "";

    headers.forEach((header, col) => {
      const field = columnMap[header];
      if (!field) return;
      const value = (cells[col] ?? "").trim();
      if (!value) return;
      if (field === "tags") rawTags = value;
      else if (field === "phone") draft.phone = cleanPhone(value);
      else if (field === "buyerType") draft.buyerType = value.toLowerCase();
      else draft[field] = value;
    });

    if (rawTags) {
      draft.tags = rawTags
        .split(/[;,|]/)
        .map((t) => t.trim())
        .filter(Boolean);
    }

    // Validate: need a way to reach them.
    const hasEmail = draft.email ? EMAIL_RE.test(draft.email) : false;
    const hasPhone = draft.phone ? draft.phone.replace(/\D/g, "").length >= 7 : false;
    if (draft.email && !hasEmail) {
      errors.push({ row: rowNum, reason: `invalid email "${draft.email}"` });
      return;
    }
    if (!hasEmail && !hasPhone) {
      errors.push({ row: rowNum, reason: "no usable email or phone" });
      return;
    }
    // Drop an invalid-but-non-fatal phone rather than failing the whole row.
    if (draft.phone && !hasPhone) delete draft.phone;
    drafts.push(draft);
  });

  return { preset, columnMap, drafts, errors, rowsTotal: dataRows.length };
}
