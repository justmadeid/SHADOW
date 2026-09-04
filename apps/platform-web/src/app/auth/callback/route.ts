import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import * as oidc from "openid-client";
import { safeReturnTo } from "@intelligence/contracts";
import { webConfig } from "../../../shell/server/config";
import { oidcConfig } from "../../../shell/server/oidc";
import { seal, unseal } from "../../../shell/server/sealed-cookie";
import { cookieNames, cookieOptions, upstream } from "../../../shell/server/session";

export async function GET(request: NextRequest) {
  const jar = await cookies();
  try {
    const c = webConfig();
    const names = cookieNames(c.secure);
    const transaction = await unseal(
      jar.get(names.login)?.value,
      "login",
      c.key,
      c.origin,
    );
    jar.delete(names.login);
    if (!transaction || request.nextUrl.search.length > 8192)
      throw new Error("Invalid login transaction");
    const callback = new URL(`${c.origin}/auth/callback`);
    callback.search = request.nextUrl.search;
    const tokens = await oidc.authorizationCodeGrant(await oidcConfig(), callback, {
      pkceCodeVerifier: transaction.verifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    const claims = tokens.claims();
    if (
      !claims ||
      !tokens.access_token ||
      tokens.token_type.toLowerCase() !== "bearer" ||
      !tokens.expires_in ||
      tokens.expires_in <= 0
    )
      throw new Error("Invalid tokens");
    const identity = await upstream("/session", tokens.access_token);
    if (!identity.ok || (await identity.json())?.user?.id !== claims.sub)
      throw new Error("Identity mismatch");
    const expiresAt = Math.floor(
      Math.min(
        Date.now() / 1000 + 900,
        Date.now() / 1000 + tokens.expires_in,
        claims.exp,
      ),
    );
    const session = await seal(
      { kind: "session", token: tokens.access_token, userId: claims.sub, expiresAt },
      c.key,
      c.origin,
    );
    const response = NextResponse.redirect(
      new URL(safeReturnTo(transaction.returnTo), c.origin),
    );
    response.headers.set("cache-control", "no-store");
    response.cookies.set(names.session, session, cookieOptions(c.secure, expiresAt));
    return response;
  } catch {
    // Do not reflect provider errors, codes, claims or tokens into logs or URLs.
    return new NextResponse(null, {
      status: 303,
      headers: { location: "/login?error=signin", "cache-control": "no-store" },
    });
  }
}
