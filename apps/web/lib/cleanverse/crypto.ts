/**
 * Request/response encryption for the Cleanverse Cooperate API.
 *
 * Spec, verbatim from `docs/cleanverse/api-v5.6.txt` §Encryption:
 *   - AES/CBC/PKCS5Padding
 *   - fixed IV of 16 zero bytes
 *   - key = Base64-decode(api-key), used directly as the AES key
 *   - ciphertext is Base64, carried as `{"data": "<ciphertext>"}`
 *
 * Our api-key decodes to 32 bytes, so this is AES-256-CBC. PKCS5Padding and PKCS7 are identical
 * for a 16-byte block, which is what Node implements by default.
 *
 * A fixed all-zero IV is weak — identical plaintexts produce identical ciphertexts, so an observer
 * learns when we repeat a request. That is Cleanverse's protocol decision, not ours, and TLS
 * carries the transport. Noted rather than silently accepted.
 *
 * Server-only. The api-key is the AES key, never a bearer token, and must not reach the browser.
 */

import { createCipheriv, createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const IV = Buffer.alloc(16, 0);

export class CleanverseCryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CleanverseCryptoError";
  }
}

/**
 * Decode the Base64 api-key into raw AES key bytes.
 *
 * Validates the length up front: a truncated or mis-pasted key would otherwise fail deep inside
 * a request with an opaque OpenSSL error.
 */
export function decodeApiKey(apiKey: string): Buffer {
  const key = Buffer.from(apiKey, "base64");
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new CleanverseCryptoError(
      `api-key must Base64-decode to 16, 24 or 32 bytes for AES; got ${key.length}. ` +
        "Check CLEANVERSE_API_KEY is the full key, copied without truncation.",
    );
  }
  return key;
}

/** Encrypt a plaintext request body, returning the Base64 string for the `data` field. */
export function encryptPayload(payload: unknown, apiKey: string): string {
  const key = decodeApiKey(apiKey);
  const cipher = createCipheriv(ALGORITHM, key, IV);
  return Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]).toString(
    "base64",
  );
}

/** Decrypt a Base64 `data` field back into the object it encodes. */
export function decryptPayload<T>(ciphertext: string, apiKey: string): T {
  const key = decodeApiKey(apiKey);
  let plaintext: string;
  try {
    const decipher = createDecipheriv(ALGORITHM, key, IV);
    plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    throw new CleanverseCryptoError(
      "Failed to decrypt a Cleanverse response. Usually a wrong api-key, or a plaintext " +
        "response mistaken for ciphertext.",
      { cause },
    );
  }

  try {
    return JSON.parse(plaintext) as T;
  } catch (cause) {
    throw new CleanverseCryptoError("Decrypted a Cleanverse response that was not valid JSON.", {
      cause,
    });
  }
}

/**
 * Verify a Cleanverse webhook signature: HMAC-SHA256 over the raw body, keyed with the same
 * Base64-decoded api-key used for AES (v5.6 is explicit that it is the key material, not the
 * api-id).
 *
 * Pass the **raw** request body, not a re-serialised object — re-serialising reorders keys and
 * changes whitespace, which changes the digest.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  apiKey: string,
): boolean {
  const expected = createHmac("sha256", decodeApiKey(apiKey)).update(rawBody, "utf8").digest();
  // Accept either encoding; the docs show hex, but tolerate Base64 rather than reject a valid call.
  const provided = /^[0-9a-f]+$/i.test(signature)
    ? Buffer.from(signature, "hex")
    : Buffer.from(signature, "base64");
  // timingSafeEqual throws on a length mismatch, which is itself an answer.
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}
