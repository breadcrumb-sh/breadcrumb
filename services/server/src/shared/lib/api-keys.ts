import { randomBytes, createHash } from "node:crypto";

export function generateApiKey(): string {
  return "bc_" + randomBytes(24).toString("hex");
}

export function generateMcpKey(): string {
  return "mcp_" + randomBytes(24).toString("hex");
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function getKeyPrefix(key: string): string {
  return key.slice(0, 10) + "...";
}
