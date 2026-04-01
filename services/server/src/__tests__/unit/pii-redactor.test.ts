import { describe, it, expect } from "vitest";
import {
  buildRedactor,
  redactString,
  redactJson,
  redactRecord,
  type PiiToggles,
  type CustomPattern,
} from "../../services/ingest/pii-redactor.js";

function allToggles(value: boolean): PiiToggles {
  return {
    email: value,
    phone: value,
    ssn: value,
    creditCard: value,
    ipAddress: value,
    dateOfBirth: value,
    usAddress: value,
    apiKey: value,
    url: value,
  };
}

function redactor(toggles: PiiToggles, custom: CustomPattern[] = []) {
  const r = buildRedactor(toggles, custom);
  if (!r) throw new Error("Expected redactor to be built");
  return r;
}

// ── buildRedactor ───────────────────────────────────────────────────────────

describe("buildRedactor", () => {
  it("returns null when nothing is enabled", () => {
    expect(buildRedactor(allToggles(false), [])).toBeNull();
  });

  it("returns a redactor when at least one toggle is on", () => {
    expect(buildRedactor({ email: true }, [])).not.toBeNull();
  });

  it("returns a redactor when only custom patterns are enabled", () => {
    expect(
      buildRedactor(allToggles(false), [
        { pattern: "SECRET", replacement: "[REDACTED]", enabled: true },
      ]),
    ).not.toBeNull();
  });

  it("skips disabled custom patterns", () => {
    expect(
      buildRedactor(allToggles(false), [
        { pattern: "SECRET", replacement: "[REDACTED]", enabled: false },
      ]),
    ).toBeNull();
  });

  it("skips invalid custom regex gracefully", () => {
    const r = buildRedactor(allToggles(false), [
      { pattern: "[invalid(", replacement: "[X]", enabled: true },
    ]);
    expect(r).toBeNull();
  });
});

// ── Email ───────────────────────────────────────────────────────────────────

describe("email redaction", () => {
  const r = redactor({ email: true });

  it("redacts a simple email", () => {
    expect(redactString("contact user@example.com please", r)).toBe(
      "contact [EMAIL_REDACTED] please",
    );
  });

  it("redacts multiple emails", () => {
    const result = redactString("a@b.com and c@d.org", r);
    expect(result).toBe("[EMAIL_REDACTED] and [EMAIL_REDACTED]");
  });

  it("does not false-positive on non-email text", () => {
    expect(redactString("this is not an email", r)).toBe("this is not an email");
  });
});

// ── Phone ───────────────────────────────────────────────────────────────────

describe("phone redaction", () => {
  const r = redactor({ phone: true });

  it("redacts US phone with parens", () => {
    expect(redactString("Call (555) 123-4567", r)).toBe("Call [PHONE_REDACTED]");
  });

  it("redacts phone with country code", () => {
    expect(redactString("Call +1-555-123-4567", r)).toBe("Call [PHONE_REDACTED]");
  });

  it("redacts phone with extension", () => {
    expect(redactString("Call 555-123-4567 ext 1234", r)).toBe("Call [PHONE_REDACTED]");
  });
});

// ── SSN ─────────────────────────────────────────────────────────────────────

describe("SSN redaction", () => {
  const r = redactor({ ssn: true });

  it("redacts a valid SSN", () => {
    expect(redactString("SSN: 123-45-6789", r)).toBe("SSN: [SSN_REDACTED]");
  });

  it("does not redact invalid SSN starting with 000", () => {
    expect(redactString("000-12-3456", r)).toBe("000-12-3456");
  });

  it("does not redact invalid SSN starting with 666", () => {
    expect(redactString("666-12-3456", r)).toBe("666-12-3456");
  });

  it("does not redact invalid SSN starting with 9xx", () => {
    expect(redactString("900-12-3456", r)).toBe("900-12-3456");
  });
});

// ── Credit card ─────────────────────────────────────────────────────────────

describe("credit card redaction", () => {
  const r = redactor({ creditCard: true });

  it("redacts a Visa number", () => {
    expect(redactString("Card: 4111 1111 1111 1111", r)).toBe(
      "Card: [CREDIT_CARD_REDACTED]",
    );
  });

  it("redacts a Mastercard number with dashes", () => {
    expect(redactString("5500-0000-0000-0004", r)).toBe("[CREDIT_CARD_REDACTED]");
  });

  it("redacts Amex (15-digit cards are not matched — regex targets 16-digit formats)", () => {
    // Amex uses 15 digits (4-6-5 grouping), which our 4x4 regex doesn't cover.
    // This is a known limitation. Users can add a custom pattern for Amex if needed.
    expect(redactString("3782 8224 6310 005", r)).toBe("3782 8224 6310 005");
  });
});

// ── IP address ──────────────────────────────────────────────────────────────

describe("IP address redaction", () => {
  const r = redactor({ ipAddress: true });

  it("redacts IPv4", () => {
    expect(redactString("Server: 192.168.1.1", r)).toBe("Server: [IP_REDACTED]");
  });

  it("does not redact invalid octets", () => {
    expect(redactString("999.999.999.999", r)).toBe("999.999.999.999");
  });
});

// ── Date of birth ───────────────────────────────────────────────────────────

describe("date of birth redaction", () => {
  const r = redactor({ dateOfBirth: true });

  it("redacts MM/DD/YYYY", () => {
    expect(redactString("DOB: 03/15/1990", r)).toBe("DOB: [DOB_REDACTED]");
  });

  it("redacts MM-DD-YYYY", () => {
    expect(redactString("Born 12-25-2000", r)).toBe("Born [DOB_REDACTED]");
  });
});

// ── US address ──────────────────────────────────────────────────────────────

describe("US address redaction", () => {
  const r = redactor({ usAddress: true });

  it("redacts a street address", () => {
    expect(redactString("Lives at 123 Main Street", r)).toBe(
      "Lives at [ADDRESS_REDACTED]",
    );
  });

  it("redacts abbreviated street types", () => {
    expect(redactString("456 Oak Ave", r)).toBe("[ADDRESS_REDACTED]");
  });
});

// ── API key ─────────────────────────────────────────────────────────────────

describe("API key redaction", () => {
  const r = redactor({ apiKey: true });

  it("redacts OpenAI key", () => {
    expect(redactString("key: sk-abc123def456ghi789jkl012mno", r)).toBe(
      "key: [API_KEY_REDACTED]",
    );
  });

  it("redacts AWS access key", () => {
    expect(redactString("AKIAIOSFODNN7EXAMPLE", r)).toBe("[API_KEY_REDACTED]");
  });

  it("redacts GitHub PAT", () => {
    expect(
      redactString("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij", r),
    ).toBe("[API_KEY_REDACTED]");
  });
});

// ── URL ─────────────────────────────────────────────────────────────────────

describe("URL redaction", () => {
  const r = redactor({ url: true });

  it("redacts https URL", () => {
    expect(redactString("Visit https://example.com/path?q=1", r)).toBe(
      "Visit [URL_REDACTED]",
    );
  });

  it("redacts http URL", () => {
    expect(redactString("Go to http://internal.corp:8080/api", r)).toBe(
      "Go to [URL_REDACTED]",
    );
  });
});

// ── Custom patterns ─────────────────────────────────────────────────────────

describe("custom patterns", () => {
  it("applies a custom regex", () => {
    const r = redactor(allToggles(false), [
      { pattern: "CUST-\\d{6}", replacement: "[CUSTOMER_ID]", enabled: true },
    ]);
    expect(redactString("Customer CUST-123456 ordered", r)).toBe(
      "Customer [CUSTOMER_ID] ordered",
    );
  });

  it("applies multiple custom patterns", () => {
    const r = redactor(allToggles(false), [
      { pattern: "CUST-\\d+", replacement: "[CID]", enabled: true },
      { pattern: "ORD-\\d+", replacement: "[OID]", enabled: true },
    ]);
    expect(redactString("CUST-1 placed ORD-2", r)).toBe("[CID] placed [OID]");
  });
});

// ── redactJson ──────────────────────────────────────────────────────────────

describe("redactJson", () => {
  const r = redactor({ email: true });

  it("redacts strings", () => {
    expect(redactJson("email: a@b.com", r)).toBe("email: [EMAIL_REDACTED]");
  });

  it("redacts nested objects", () => {
    const result = redactJson({ user: { email: "a@b.com" } }, r);
    expect(result).toEqual({ user: { email: "[EMAIL_REDACTED]" } });
  });

  it("redacts arrays", () => {
    const result = redactJson(["a@b.com", "plain"], r);
    expect(result).toEqual(["[EMAIL_REDACTED]", "plain"]);
  });

  it("passes through numbers and booleans", () => {
    expect(redactJson(42, r)).toBe(42);
    expect(redactJson(true, r)).toBe(true);
    expect(redactJson(null, r)).toBe(null);
  });
});

// ── redactRecord ────────────────────────────────────────────────────────────

describe("redactRecord", () => {
  it("redacts all string values in a record", () => {
    const r = redactor({ email: true });
    expect(redactRecord({ a: "a@b.com", b: "safe" }, r)).toEqual({
      a: "[EMAIL_REDACTED]",
      b: "safe",
    });
  });
});

// ── Combined patterns ───────────────────────────────────────────────────────

describe("multiple built-in patterns together", () => {
  it("redacts email and phone in the same string", () => {
    const r = redactor({ email: true, phone: true });
    const result = redactString("Contact a@b.com or 555-123-4567", r);
    expect(result).toBe("Contact [EMAIL_REDACTED] or [PHONE_REDACTED]");
  });
});
