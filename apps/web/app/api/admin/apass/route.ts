/**
 * Admin: bind an A-Pass to an address.
 *
 * Guarded, because it mints real identity at Cleanverse and is not something an anonymous caller
 * should be able to trigger. Used by the deploy flow to onboard `CreditPool` and `JobEscrow` —
 * which need passes of their own to receive aUSDC at all — and by operator onboarding.
 *
 * Idempotent: the customerId is derived from the address, so repeat calls return the existing
 * pass rather than minting a second one.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { isAddress } from "viem";

import {
  CleanverseApiError,
  CleanverseConfigError,
  canHoldAsset,
  ensureApass,
  type Chain,
} from "@/lib/cleanverse";

/** Constant-time compare so the key can't be recovered by timing the endpoint. */
function authorised(request: NextRequest): boolean {
  const expected = process.env.CLEANVERSE_ADMIN_KEY;
  // An unset key denies everything. An endpoint that mints identity must never be open by default.
  if (!expected) return false;

  const provided = request.headers.get("x-admin-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface OnboardBody {
  address?: string;
  chain?: Chain;
  validityDays?: number;
  subTier?: number;
  subGroup?: string;
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  let body: OnboardBody;
  try {
    body = (await request.json()) as OnboardBody;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  if (!body.address || !isAddress(body.address)) {
    return NextResponse.json(
      { error: "`address` is required and must be a valid EVM address." },
      { status: 400 },
    );
  }

  try {
    const result = await ensureApass({
      address: body.address,
      chain: body.chain,
      validityDays: body.validityDays,
      subTier: body.subTier,
      subGroup: body.subGroup,
    });

    return NextResponse.json({
      ...result,
      canHoldAsset: canHoldAsset(result),
      // Spelled out because "created: false" alone reads as a failure at a glance.
      note: result.created
        ? "A-Pass minted."
        : "An A-Pass already existed for this address; nothing was minted.",
    });
  } catch (error) {
    if (error instanceof CleanverseConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof CleanverseApiError) {
      // Surface Cleanverse's own code and request id — the only handle their support has.
      return NextResponse.json(
        { error: error.message, code: error.code, requestId: error.requestId },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Onboarding failed." },
      { status: 500 },
    );
  }
}
