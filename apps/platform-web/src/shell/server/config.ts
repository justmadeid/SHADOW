import "server-only";

export function webConfig() {
  const origin = endpoint(process.env.WEB_ORIGIN);
  if (new URL(origin).origin !== origin) throw new Error("WEB_ORIGIN must be an origin");
  const issuer = endpoint(process.env.WEB_OIDC_ISSUER);
  const api = endpoint(process.env.WEB_PLATFORM_API_URL);
  const clientId = process.env.WEB_OIDC_CLIENT_ID;
  const key = process.env.WEB_SESSION_KEY;
  if (!clientId || !key || !/^[0-9a-f]{64}$/i.test(key))
    throw new Error("Web authentication is not configured");
  return {
    origin,
    issuer,
    api,
    clientId,
    audience: process.env.WEB_OIDC_AUDIENCE || undefined,
    key: new Uint8Array(Buffer.from(key, "hex")),
    secret: process.env.WEB_OIDC_CLIENT_SECRET,
    scope: process.env.WEB_OIDC_SCOPE ?? "openid",
    secure: new URL(origin).protocol === "https:",
  };
}

function endpoint(value: string | undefined): string {
  if (!value) throw new Error("Missing web configuration");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:"))
  )
    throw new Error("Invalid web endpoint");
  return url.href.replace(/\/$/, "");
}
