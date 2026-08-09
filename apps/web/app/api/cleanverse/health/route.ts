/**
 * Cleanverse integration health check.
 *
 * Exercises each layer independently — config, encryption, live API, and the resolved settlement
 * asset — so a failure points at one thing instead of "Cleanverse is down". The dashboard reads
 * this to render integration status; it is also the fastest way to confirm credentials after a
 * key rotation.
 *
 * Read-only. It never issues an A-Pass, mutates a rule, or spends anything.
 */

import { NextResponse } from "next/server";

import {
  CleanverseApiError,
  decodeApiKey,
  decryptPayload,
  encryptPayload,
  getCleanverseConfig,
  isCleanverseConfigured,
  listSupportedATokens,
} from "@/lib/cleanverse";

// No `export const dynamic` here: this project runs Next 16 with cacheComponents, which rejects
// route segment config. The handler is dynamic regardless — it reads process.env at request time
// and every Cleanverse fetch sets `cache: "no-store"`.

type CheckStatus = "ok" | "failed" | "skipped";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const ASSET_SYMBOL = "ausdc";

export async function GET() {
  const checks: Check[] = [];

  if (!isCleanverseConfigured()) {
    return NextResponse.json(
      {
        healthy: false,
        checks: [
          {
            name: "credentials",
            status: "failed",
            detail:
              "CLEANVERSE_API_ID / CLEANVERSE_API_KEY are not set. See apps/web/.env.example.",
          },
        ],
      },
      { status: 503 },
    );
  }

  const config = getCleanverseConfig();
  checks.push({
    name: "credentials",
    status: "ok",
    detail: `api-id ${config.apiId} against ${config.environment} (${config.defaultChain})`,
  });

  // Encryption is entirely local — proving it here separates "our AES is wrong" from "their API
  // rejected us", which are otherwise indistinguishable from a 0001 response.
  try {
    const keyBits = decodeApiKey(config.apiKey).length * 8;
    const probe = { probe: "cleanverse-health", at: Date.now() };
    const roundTripped = decryptPayload<typeof probe>(
      encryptPayload(probe, config.apiKey),
      config.apiKey,
    );
    if (roundTripped.at !== probe.at) throw new Error("round-trip mismatch");
    checks.push({
      name: "encryption",
      status: "ok",
      detail: `AES-${keyBits}-CBC round-trip succeeded (fixed zero IV, PKCS7)`,
    });
  } catch (error) {
    checks.push({
      name: "encryption",
      status: "failed",
      detail: error instanceof Error ? error.message : "unknown encryption failure",
    });
  }

  // One live read. Confirms the api-id is accepted and the chain is supported, and resolves the
  // settlement asset in the same call.
  try {
    const { tokens } = await listSupportedATokens();
    checks.push({
      name: "api",
      status: "ok",
      detail: `query_deposit_atoken_list returned ${tokens.length} token(s) on ${config.defaultChain}`,
    });

    const asset = tokens.find((t) => t.atoken.symbol.toLowerCase() === ASSET_SYMBOL);
    const configured = process.env.ASSET_ADDRESS;

    if (!asset) {
      checks.push({
        name: "settlement-asset",
        status: "failed",
        detail: `No ${ASSET_SYMBOL} on ${config.defaultChain}. The pool has no A-Token to denominate in.`,
      });
    } else if (!configured) {
      checks.push({
        name: "settlement-asset",
        status: "failed",
        detail: `ASSET_ADDRESS is unset. ${asset.atoken.symbol} lives at ${asset.atoken.address}.`,
      });
    } else if (configured.toLowerCase() !== asset.atoken.address.toLowerCase()) {
      // A silent mismatch here would mean the contracts settle in a token Cleanverse doesn't gate.
      checks.push({
        name: "settlement-asset",
        status: "failed",
        detail: `ASSET_ADDRESS (${configured}) does not match ${asset.atoken.symbol} at ${asset.atoken.address}.`,
      });
    } else {
      checks.push({
        name: "settlement-asset",
        status: "ok",
        detail: `${asset.atoken.symbol} at ${asset.atoken.address} (${asset.atoken.decimals} decimals)`,
      });
    }
  } catch (error) {
    checks.push({
      name: "api",
      status: "failed",
      detail:
        error instanceof CleanverseApiError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : "unknown API failure",
    });
    checks.push({
      name: "settlement-asset",
      status: "skipped",
      detail: "Not checked — the API call above failed.",
    });
  }

  const healthy = checks.every((c) => c.status === "ok");
  return NextResponse.json({ healthy, checks }, { status: healthy ? 200 : 503 });
}
