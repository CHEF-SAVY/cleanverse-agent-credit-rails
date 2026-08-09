/**
 * The single HTTP seam to the Cleanverse Cooperate API.
 *
 * Everything goes through {@link cleanverseRequest}: header assembly, the encrypted/plain split,
 * envelope unwrapping, and error normalisation. Endpoint modules stay thin and declarative.
 */

import { randomUUID } from "node:crypto";

import { decryptPayload, encryptPayload } from "./crypto";
import { getCleanverseConfig, type CleanverseConfig } from "./env";
import { SUCCESS_CODE, type ApiEnvelope } from "./types";

/**
 * A non-`0000` response. Carries the code so callers can branch on specific failures rather than
 * string-matching messages.
 */
export class CleanverseApiError extends Error {
  readonly code: string;
  readonly endpoint: string;
  readonly requestId: string;

  constructor(args: { code: string; message: string; endpoint: string; requestId: string }) {
    super(`Cleanverse ${args.endpoint} failed [${args.code}]: ${args.message}`);
    this.name = "CleanverseApiError";
    this.code = args.code;
    this.endpoint = args.endpoint;
    this.requestId = args.requestId;
  }

  /**
   * A paused compliance pool answers `12027` in place of a verdict. Callers that gate credit must
   * treat this as "denied", never as "allowed".
   */
  get isPoolPaused(): boolean {
    return this.code === "12027";
  }
}

/** Transport-level failure — DNS, TLS, timeout, or a non-2xx with no parseable envelope. */
export class CleanverseTransportError extends Error {
  readonly endpoint: string;
  readonly requestId: string;

  constructor(args: {
    message: string;
    endpoint: string;
    requestId: string;
    cause?: unknown;
  }) {
    super(`Cleanverse ${args.endpoint} unreachable: ${args.message}`, { cause: args.cause });
    this.name = "CleanverseTransportError";
    this.endpoint = args.endpoint;
    this.requestId = args.requestId;
  }
}

export interface RequestOptions {
  /**
   * Encrypt the request body and expect an encrypted response.
   *
   * Which endpoints require this is fixed by the API, not chosen by us — see the list in
   * `docs/cleanverse/api-v5.6.txt` §Encryption. Each endpoint module sets it explicitly rather
   * than inferring from the path, so the choice is auditable at the call site.
   */
  encrypted: boolean;
  /** Milliseconds before the request is aborted. */
  timeoutMs?: number;
  config?: CleanverseConfig;
  signal?: AbortSignal;
  /**
   * Retry attempts on **transport** failure (timeout, DNS, connection reset). Never on an API
   * error response — a `0002` means Cleanverse understood us and said no.
   *
   * Safe only for idempotent reads. A retried write could apply twice on-chain, so this stays 0
   * for anything that mutates. See docs/backend-integration-plan.md §2.7.
   */
  retries?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Some encrypted endpoints return a plaintext envelope anyway (notably errors, which are emitted
 * before the handler decides to encrypt). Detect ciphertext rather than assuming.
 */
function looksLikeCiphertext(data: unknown): data is string {
  return typeof data === "string" && data.length > 0 && !data.trimStart().startsWith("{");
}

export async function cleanverseRequest<TResponse, TRequest = unknown>(
  endpoint: string,
  body: TRequest,
  options: RequestOptions,
): Promise<TResponse> {
  const attempts = Math.max(0, options.retries ?? 0) + 1;
  let lastTransportError: unknown;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await sendOnce<TResponse, TRequest>(endpoint, body, options);
    } catch (error) {
      // Only transport failures are retryable; an API error is a real answer.
      if (!(error instanceof CleanverseTransportError) || attempt === attempts - 1) throw error;
      lastTransportError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }

  throw lastTransportError;
}

async function sendOnce<TResponse, TRequest>(
  endpoint: string,
  body: TRequest,
  options: RequestOptions,
): Promise<TResponse> {
  const config = options.config ?? getCleanverseConfig();
  const requestId = randomUUID();
  const url = `${config.baseUrl}${endpoint}`;

  const payload = options.encrypted
    ? { data: encryptPayload(body, config.apiKey) }
    : (body as unknown);

  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-id": config.apiId,
        "X-Request-ID": requestId,
      },
      body: JSON.stringify(payload),
      signal,
      cache: "no-store",
    });
  } catch (cause) {
    throw new CleanverseTransportError({
      message: cause instanceof Error ? cause.message : "request failed",
      endpoint,
      requestId,
      cause,
    });
  }

  const text = await response.text();

  let envelope: ApiEnvelope<unknown>;
  try {
    envelope = JSON.parse(text) as ApiEnvelope<unknown>;
  } catch (cause) {
    throw new CleanverseTransportError({
      message: `HTTP ${response.status} with a non-JSON body: ${text.slice(0, 200)}`,
      endpoint,
      requestId,
      cause,
    });
  }

  if (envelope.code !== SUCCESS_CODE) {
    throw new CleanverseApiError({
      code: envelope.code,
      message: envelope.message,
      endpoint,
      requestId,
    });
  }

  if (options.encrypted && looksLikeCiphertext(envelope.data)) {
    return decryptPayload<TResponse>(envelope.data, config.apiKey);
  }
  return envelope.data as TResponse;
}
