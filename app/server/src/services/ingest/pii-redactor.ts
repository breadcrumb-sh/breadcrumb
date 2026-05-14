/**
 * Regex-based PII redaction for the ingest pipeline.
 * Pure functions — no side effects, no DB access.
 */

// ── Built-in PII patterns ──────────────────────────────────────────────────

export type BuiltInPiiType =
  | "email"
  | "phone"
  | "ssn"
  | "creditCard"
  | "ipAddress"
  | "dateOfBirth"
  | "usAddress"
  | "apiKey"
  | "url";

type PatternDef = {
  regex: RegExp;
  replacement: string;
};

const BUILT_IN_PATTERNS: Record<BuiltInPiiType, PatternDef> = {
  email: {
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    replacement: "[EMAIL_REDACTED]",
  },
  phone: {
    // Require at least one separator (dash, dot, space, parens) or leading +/1 to avoid matching hex strings in UUIDs/IDs
    regex: /(?:\+1[-.\s]?|1[-.\s])\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x|ext\.)\s*\d{1,5})?|\(?\d{3}\)[-.\s]\d{3}[-.\s]?\d{4}(?:\s*(?:ext|x|ext\.)\s*\d{1,5})?|\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}(?:\s*(?:ext|x|ext\.)\s*\d{1,5})?/g,
    replacement: "[PHONE_REDACTED]",
  },
  ssn: {
    regex: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    replacement: "[SSN_REDACTED]",
  },
  creditCard: {
    regex: /\b(?:4\d{3}|5[1-5]\d{2}|3[47]\d{2}|6(?:011|5\d{2}))[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,
    replacement: "[CREDIT_CARD_REDACTED]",
  },
  ipAddress: {
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    replacement: "[IP_REDACTED]",
  },
  dateOfBirth: {
    regex: /\b(?:0[1-9]|1[0-2])[\/\-](?:0[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g,
    replacement: "[DOB_REDACTED]",
  },
  usAddress: {
    regex: /\b\d{1,5}\s+[\w\s]{1,40}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Ln|Lane|Rd|Road|Way|Ct|Court|Pl(?:ace)?|Cir(?:cle)?)\b/gi,
    replacement: "[ADDRESS_REDACTED]",
  },
  apiKey: {
    regex: /\b(?:sk-[a-zA-Z0-9]{20,}|sk-proj-[a-zA-Z0-9\-_]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{22,}|xox[bprs]-[a-zA-Z0-9\-]{10,})\b/g,
    replacement: "[API_KEY_REDACTED]",
  },
  url: {
    regex: /https?:\/\/[^\s"'<>)\]]+/g,
    replacement: "[URL_REDACTED]",
  },
};

// ── Compiled redactor ──────────────────────────────────────────────────────

export type CompiledRedactor = {
  patterns: Array<{ regex: RegExp; replacement: string }>;
};

export type PiiToggles = Partial<Record<BuiltInPiiType, boolean>>;

export type CustomPattern = {
  pattern: string;
  replacement: string;
  enabled: boolean;
};

export function buildRedactor(
  toggles: PiiToggles,
  customPatterns: CustomPattern[],
): CompiledRedactor | null {
  const patterns: CompiledRedactor["patterns"] = [];

  for (const [type, def] of Object.entries(BUILT_IN_PATTERNS)) {
    if (toggles[type as BuiltInPiiType]) {
      // Clone regex so lastIndex resets per call
      patterns.push({ regex: new RegExp(def.regex.source, def.regex.flags), replacement: def.replacement });
    }
  }

  for (const cp of customPatterns) {
    if (!cp.enabled) continue;
    try {
      patterns.push({ regex: new RegExp(cp.pattern, "g"), replacement: cp.replacement });
    } catch {
      // Skip invalid patterns — they're validated at save time
    }
  }

  return patterns.length > 0 ? { patterns } : null;
}

// ── Redaction functions ────────────────────────────────────────────────────

export function redactString(value: string, redactor: CompiledRedactor): string {
  let result = value;
  for (const { regex, replacement } of redactor.patterns) {
    regex.lastIndex = 0;
    result = result.replace(regex, replacement);
  }
  return result;
}

export function redactJson(value: unknown, redactor: CompiledRedactor): unknown {
  if (typeof value === "string") return redactString(value, redactor);
  if (Array.isArray(value)) return value.map((item) => redactJson(item, redactor));
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactJson(v, redactor);
    }
    return out;
  }
  return value;
}

export function redactRecord(
  record: Record<string, string>,
  redactor: CompiledRedactor,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    out[k] = redactString(v, redactor);
  }
  return out;
}
