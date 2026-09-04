import { NextRequest, NextResponse } from "next/server";
import * as oidc from "openid-client";
import { safeReturnTo } from "@intelligence/contracts";
import { webConfig } from "../../../shell/server/config";
import { oidcConfig } from "../../../shell/server/oidc";
import { seal } from "../../../shell/server/sealed-cookie";
import { cookieNames, cookieOptions } from "../../../shell/server/session";

export async function GET(request: NextRequest) {
  try {
    const c = webConfig();
    const config = await oidcConfig();
    const transaction = {
      kind: "login" as const,
      verifier: oidc.randomPKCECodeVerifier(),
      state: oidc.randomState(),
      nonce: oidc.randomNonce(),
      returnTo: safeReturnTo(request.nextUrl.searchParams.get("returnTo")),
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${c.origin}/auth/callback`,
      scope: c.scope,
      ...(c.audience ? { audience: c.audience } : {}),
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier),
      code_challenge_method: "S256",
      prompt: "login",
    });
    const response = NextResponse.redirect(url);
    response.headers.set("cache-control", "no-store");
    response.cookies.set(
      cookieNames(c.secure).login,
      await seal(transaction, c.key, c.origin),
      cookieOptions(c.secure, transaction.expiresAt),
    );
    return response;
  } catch {
    return NextResponse.json(
      {
        error: {
          code: "AUTH_CONFIGURATION_UNAVAILABLE",
          message: "Sign-in is unavailable. Contact your administrator.",
        },
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
