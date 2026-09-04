import "server-only";
import * as oidc from "openid-client";
import { webConfig } from "./config";

export async function oidcConfig() {
  const c = webConfig();
  const config = await oidc.discovery(
    new URL(c.issuer),
    c.clientId,
    c.secret ? { client_secret: c.secret } : undefined,
    c.secret ? oidc.ClientSecretPost(c.secret) : oidc.None(),
    {
      timeout: 8,
      ...(c.issuer.startsWith("http:") ? { execute: [oidc.allowInsecureRequests] } : {}),
      [oidc.customFetch]: (url, options) =>
        fetch(url, {
          ...options,
          body:
            options.body instanceof Uint8Array
              ? new Uint8Array(options.body).buffer
              : (options.body ?? null),
          redirect: "error",
          cache: "no-store",
        }),
    },
  );
  oidc.enableNonRepudiationChecks(config);
  return config;
}
