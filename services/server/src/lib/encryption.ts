import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

function getKey(): Buffer {
  const hex = env.encryptionKey;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return Buffer.from(hex, "hex");
}

/** AES-256-GCM encrypt. Returns "iv:ciphertext:authTag" (all hex). */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${encrypted.toString("hex")}:${authTag.toString("hex")}`;
}

/** Decrypt a value produced by `encrypt()`. */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const [ivHex, ciphertextHex, authTagHex] = encrypted.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivHex, "hex")
  );
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

/** Mask an API key for display: "sk-proj-...z123" */
export function maskApiKey(key: string): string {
  if (key.length <= 10) return "••••••••";
  return `${key.slice(0, 6)}...${key.slice(-4)}`;
}
