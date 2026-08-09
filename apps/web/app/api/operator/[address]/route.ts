/**
 * Operator eligibility — the read the dashboard is built on.
 *
 * Returns the A-Pass, every credit band with a verdict, and a reason for each denial. Public read:
 * it exposes only what the operator's own wallet already commits to on Cleanverse, and no write is
 * possible here.
 *
 * Deliberately not cached. A compliance verdict is a live decision — see the note on caching in
 * docs/backend-integration-plan.md §2.2.
 */

import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { CleanverseConfigError, evaluateEligibility } from "@/lib/cleanverse";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  if (!isAddress(address)) {
    return NextResponse.json(
      { error: "Not a valid EVM address.", code: "INVALID_ADDRESS" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await evaluateEligibility(address));
  } catch (error) {
    if (error instanceof CleanverseConfigError) {
      return NextResponse.json(
        { error: error.message, code: "NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Eligibility check failed.",
        code: "ELIGIBILITY_UNAVAILABLE",
      },
      { status: 502 },
    );
  }
}
