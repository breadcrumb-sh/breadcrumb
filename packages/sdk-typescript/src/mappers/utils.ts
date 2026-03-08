import type { Attributes } from "@opentelemetry/api";

export function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function strAttr(attrs: Attributes, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

export function intAttr(attrs: Attributes, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "number") return Math.round(v);
  }
  return undefined;
}

export function floatAttr(attrs: Attributes, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const v = attrs[key];
    if (typeof v === "number") return v;
  }
  return undefined;
}
