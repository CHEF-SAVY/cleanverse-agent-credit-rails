/**
 * Admin: retune one credit band's compliance rule, live.
 *
 * The demo action. Restricting a jurisdiction here changes what an operator can borrow on-chain,
 * with no redeploy — because the rule belongs to Cleanverse's validator, not to us.
 *
 * `GET` returns the band's current rule alongside its default, so a UI can show drift and offer
 * a reset without guessing.
 */

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

import {
  bandAddressesFromEnv,
  getBand,
  getPoolRules,
  resetBandRule,
  restrictBandByCountry,
  setBandRule,
  type ComplianceRule,
  type CountryMode,
} from "@/lib/cleanverse";

function authorised(request: NextRequest): boolean {
  const expected = process.env.CLEANVERSE_ADMIN_KEY;
  if (!expected) return false;
  const a = Buffer.from(request.headers.get("x-admin-key") ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Body =
  | { action: "restrict-country"; countries: string[]; mode?: CountryMode }
  | { action: "reset" }
  | { action: "set"; rule: ComplianceRule };

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const { label } = await params;
  const band = getBand(label);
  if (!band) return NextResponse.json({ error: `Unknown band "${label}".` }, { status: 404 });

  const address = bandAddressesFromEnv()[band.label] ?? null;
  const current = address
    ? await getPoolRules({ contractAddress: address })
        .then((r) => r.rules)
        .catch(() => null)
    : null;

  return NextResponse.json({
    label: band.label,
    description: band.description,
    address,
    limit: band.limit.toString(),
    defaultRule: band.rule,
    currentRules: current,
    // Cheap for the UI to consume; JSON.stringify comparison is fine for a 6-field flat object.
    modified: current ? JSON.stringify(current) !== JSON.stringify([band.rule]) : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ label: string }> },
) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorised." }, { status: 401 });
  }

  const { label } = await params;
  if (!getBand(label)) {
    return NextResponse.json({ error: `Unknown band "${label}".` }, { status: 404 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  try {
    switch (body.action) {
      case "restrict-country": {
        if (!Array.isArray(body.countries) || body.countries.length === 0) {
          return NextResponse.json(
            { error: "`countries` must be a non-empty array of ISO-3166-1 alpha-2 codes." },
            { status: 400 },
          );
        }
        if (!body.countries.every((c) => typeof c === "string" && /^[A-Za-z]{2}$/.test(c))) {
          return NextResponse.json(
            { error: "Each country must be a two-letter ISO-3166-1 alpha-2 code, e.g. \"NG\"." },
            { status: 400 },
          );
        }
        return NextResponse.json(
          await restrictBandByCountry({ label, countries: body.countries, mode: body.mode }),
        );
      }
      case "reset":
        return NextResponse.json(await resetBandRule({ label }));
      case "set":
        if (!body.rule) {
          return NextResponse.json({ error: "`rule` is required for action \"set\"." }, { status: 400 });
        }
        return NextResponse.json(await setBandRule({ label, rule: body.rule }));
      default:
        return NextResponse.json(
          { error: 'Unknown action. Use "restrict-country", "reset" or "set".' },
          { status: 400 },
        );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Rule change failed." },
      { status: 502 },
    );
  }
}
