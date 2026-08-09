/**
 * Admin: register the credit bands as Cleanverse compliance pools.
 *
 * Safe to re-run. Bands already registered are reported and skipped, so a partial failure is
 * fixed by calling this again rather than by unpicking state.
 *
 * `GET` reports current registration status without writing anything — use it to check before and
 * after, and to drive the dashboard's setup view.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { Hex } from "viem";

import {
  CREDIT_BANDS,
  bandAddressesFromEnv,
  getPoolRules,
  isPoolRegistered,
  registerAllBands,
} from "@/lib/cleanverse";

function authorised(request: NextRequest): boolean {
  const expected = process.env.CLEANVERSE_ADMIN_KEY;
  if (!expected) return false;
  const a = Buffer.from(request.headers.get("x-admin-key") ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const addresses = bandAddressesFromEnv();

  const bands = await Promise.all(
    CREDIT_BANDS.map(async (band) => {
      const address = addresses[band.label];
      if (!address) {
        return { label: band.label, address: null, registered: false, rules: null };
      }
      try {
        const [registration, rules] = await Promise.all([
          isPoolRegistered({ contractAddress: address }),
          // Reads are safe to parallelise; only the writes must be serialised.
          getPoolRules({ contractAddress: address }).catch(() => null),
        ]);
        return {
          label: band.label,
          address,
          registered: registration.registered,
          limit: band.limit.toString(),
          expectedRule: band.rule,
          rules: rules?.rules ?? null,
        };
      } catch (error) {
        return {
          label: band.label,
          address,
          registered: false,
          error: error instanceof Error ? error.message : "status check failed",
        };
      }
    }),
  );

  return NextResponse.json({ bands });
}

export async function POST(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const ownerPrivateKey = process.env.POOL_OWNER_PRIVATE_KEY as Hex | undefined;
  if (!ownerPrivateKey) {
    return NextResponse.json(
      {
        error:
          "POOL_OWNER_PRIVATE_KEY is not set. Registration is signed by the gate contracts' " +
          "owner; Cleanverse checks it against Ownable.owner().",
      },
      { status: 503 },
    );
  }

  const addresses = bandAddressesFromEnv();
  if (Object.keys(addresses).length === 0) {
    return NextResponse.json(
      { error: "No GATE_BAND_* addresses configured. Deploy the gates first (DeployGates.s.sol)." },
      { status: 503 },
    );
  }

  const outcomes = await registerAllBands({ addresses, ownerPrivateKey });
  const failed = outcomes.filter((o) => o.status === "failed");

  return NextResponse.json(
    { outcomes, registered: outcomes.length - failed.length, failed: failed.length },
    // 207: some bands may have registered while others failed, and the body says which.
    { status: failed.length === 0 ? 200 : 207 },
  );
}
