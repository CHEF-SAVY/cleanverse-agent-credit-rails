/**
 * Server-side configuration for the Cleanverse Cooperate API.
 *
 * Deliberately read at call time rather than at module load: a missing credential should surface
 * as a clear error on the one route that needs it, not as a boot failure that takes down pages
 * which never touch Cleanverse.
 */

import type { Chain } from "./types";

export const CLEANVERSE_BASE_URLS = {
  sandbox: "https://uatapi.cleanverse.com/api/cooperate",
  production: "https://api.cleanverse.com/api/cooperate",
} as const;

export type CleanverseEnvironment = keyof typeof CLEANVERSE_BASE_URLS;

export interface CleanverseConfig {
  apiId: string;
  apiKey: string;
  baseUrl: string;
  environment: CleanverseEnvironment;
  /** The chain our contracts are deployed to. Every call defaults to this. */
  defaultChain: Chain;
}

export class CleanverseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CleanverseConfigError";
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new CleanverseConfigError(
      `${name} is not set. Cleanverse credentials come from Cleanverse directly — see ` +
        "docs/cleanverse/open-questions.md. Set it in apps/web/.env.local (never NEXT_PUBLIC_).",
    );
  }
  return value;
}

export function getCleanverseConfig(): CleanverseConfig {
  if (typeof window !== "undefined") {
    // The api-key is the AES key. If this ever evaluates in a browser bundle, the key is already
    // compromised — fail loudly rather than let it ship.
    throw new CleanverseConfigError(
      "getCleanverseConfig() was called in the browser. The Cleanverse api-key is an encryption " +
        "key and must stay server-side; call this only from route handlers or server actions.",
    );
  }

  const environment = (process.env.CLEANVERSE_ENV ?? "sandbox") as CleanverseEnvironment;
  if (!(environment in CLEANVERSE_BASE_URLS)) {
    throw new CleanverseConfigError(
      `CLEANVERSE_ENV must be "sandbox" or "production"; got "${environment}".`,
    );
  }

  return {
    apiId: required("CLEANVERSE_API_ID"),
    apiKey: required("CLEANVERSE_API_KEY"),
    baseUrl: CLEANVERSE_BASE_URLS[environment],
    environment,
    defaultChain: (process.env.CLEANVERSE_CHAIN ?? "monad") as Chain,
  };
}

/** True when credentials are present, for rendering a "not configured" state instead of throwing. */
export function isCleanverseConfigured(): boolean {
  return Boolean(process.env.CLEANVERSE_API_ID && process.env.CLEANVERSE_API_KEY);
}
