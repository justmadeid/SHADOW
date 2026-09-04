import { NextRequest, NextResponse } from "next/server";
import { safeReturnTo } from "@intelligence/contracts";
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`;
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  headers.set(
    "x-shell-return",
    safeReturnTo(request.nextUrl.pathname + request.nextUrl.search),
  );
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  // Preserve the Origin of same-origin form POSTs without leaking context off-site.
  // Auth callback URLs can contain authorization codes and never send a referrer.
  response.headers.set(
    "referrer-policy",
    request.nextUrl.pathname.startsWith("/auth/") ? "no-referrer" : "same-origin",
  );
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("cache-control", "private, no-store");
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
