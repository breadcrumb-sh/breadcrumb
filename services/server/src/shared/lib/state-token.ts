import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../../env.js";

/**
 * Short-lived signed token used to round-trip a project + user identity
 * through GitHub during the App install flow.
 *
 * The token is HS256-signed with a key *derived* from `ENCRYPTION_KEY` (not
 * the raw key itself) so that a state-token compromise cannot be used to
 * decrypt unrelated values. Derivation is `SHA-256(label || key)` with a
 * versioned label so we can rotate the derivation if needed.
 *
 * The payload only contains identifiers — never secrets — and the token
 * expires after 10 minutes.
 */

const ISSUER = "breadcrumb-github-install";
const AUDIENCE = "breadcrumb-github-install";
const DEFAULT_TTL_SECONDS = 600; // 10 minutes
const KEY_DERIVATION_LABEL = "breadcrumb-state-token-v1:";

export type StateTokenPayload = {
  projectId: string;
  userId: string;
};

let cachedKey: Uint8Array | null = null;

function getSigningKey(): Uint8Array {
  if (cachedKey) return cachedKey;
  const hex = env.encryptionKey;
  if (!hex || hex.length !== 64) {
    throw new Error("ENCRYPTION_KEY must be a 64-character hex string (32 bytes)");
  }
  const hash = createHash("sha256");
  hash.update(KEY_DERIVATION_LABEL);
  hash.update(Buffer.from(hex, "hex"));
  cachedKey = hash.digest();
  return cachedKey;
}

export async function signStateToken(
  payload: StateTokenPayload,
  options: { ttlSeconds?: number } = {},
): Promise<string> {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  return await new SignJWT({
    projectId: payload.projectId,
    userId: payload.userId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setExpirationTime(`${ttl}s`)
    .setJti(randomUUID())
    .sign(getSigningKey());
}

export async function verifyStateToken(
  token: string,
): Promise<StateTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (
      typeof payload.projectId !== "string" ||
      typeof payload.userId !== "string"
    ) {
      return null;
    }
    return {
      projectId: payload.projectId,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

/** For tests: clear the cached derived key so a new env mock takes effect. */
export function __resetStateTokenKeyCache() {
  cachedKey = null;
}
