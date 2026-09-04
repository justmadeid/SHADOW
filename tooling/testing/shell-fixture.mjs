// Synthetic OIDC + API fixture. Test process only; never imported by the application.
import http from "node:http";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";

const origin = "http://127.0.0.1:43101";
const web = "http://127.0.0.1:3000";
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...publicKey.export({ format: "jwk" }),
  kid: "fixture",
  use: "sig",
  alg: "RS256",
};
const codes = new Map();
const sessions = new Map();
const workspaceId = "01900000-0000-7000-8000-000000000001";
const secondWorkspaceId = "01900000-0000-7000-8000-000000000002";
const caseId = "01900000-0000-7000-8000-000000000003";
const secondCaseId = "01900000-0000-7000-8000-000000000004";
const cases = [
  {
    id: caseId,
    workspaceId,
    code: "CASE-SYNTHETIC",
    title: "Synthetic investigation",
    classification: "SENSITIVE",
    status: "ACTIVE",
    revision: 1,
  },
  {
    id: secondCaseId,
    workspaceId: secondWorkspaceId,
    code: "CASE-SECOND",
    title: "Second workspace case",
    classification: "INTERNAL",
    status: "DRAFT",
    revision: 1,
  },
];
const workspaces = [
  { id: workspaceId, name: "Synthetic Workspace" },
  { id: secondWorkspaceId, name: "Second Workspace" },
];

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  const json = (status, body) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    response.end(JSON.stringify(body));
  };
  const redirect = (location) => {
    response.writeHead(302, { location, "cache-control": "no-store" });
    response.end();
  };
  if (url.pathname === "/health") return json(200, { ready: true });
  if (url.pathname === "/.well-known/openid-configuration")
    return json(200, {
      issuer: origin,
      authorization_endpoint: `${origin}/authorize`,
      token_endpoint: `${origin}/token`,
      jwks_uri: `${origin}/jwks`,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      token_endpoint_auth_methods_supported: ["client_secret_post"],
      code_challenge_methods_supported: ["S256"],
    });
  if (url.pathname === "/jwks") return json(200, { keys: [jwk] });
  if (url.pathname === "/__fixture/role") {
    response.setHeader(
      "set-cookie",
      `fixture-role=${url.searchParams.get("role") === "viewer" ? "viewer" : "owner"}; Path=/; HttpOnly; SameSite=Lax`,
    );
    return json(200, { ok: true });
  }
  if (url.pathname === "/__fixture/control") {
    const session = [...sessions.values()].find(
      (s) => s.id === url.searchParams.get("user"),
    );
    if (!session) return json(404, {});
    session.mode = url.searchParams.get("mode");
    return json(200, { ok: true });
  }
  if (url.pathname === "/authorize") {
    if (
      url.searchParams.get("redirect_uri") !== `${web}/auth/callback` ||
      url.searchParams.get("client_id") !== "platform-web-test" ||
      url.searchParams.get("audience") !== "platform-api-test" ||
      url.searchParams.get("code_challenge_method") !== "S256"
    )
      return json(400, {});
    const code = randomUUID();
    codes.set(code, {
      challenge: url.searchParams.get("code_challenge"),
      nonce: url.searchParams.get("nonce"),
      role: request.headers.cookie?.includes("fixture-role=viewer") ? "viewer" : "owner",
    });
    const target = new URL(`${web}/auth/callback`);
    target.searchParams.set("code", code);
    target.searchParams.set("state", url.searchParams.get("state"));
    return redirect(target.href);
  }
  if (url.pathname === "/token" && request.method === "POST") {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 8192) return json(400, {});
    }
    const body = new URLSearchParams(raw);
    const record = codes.get(body.get("code"));
    codes.delete(body.get("code"));
    if (
      !record ||
      body.get("client_id") !== "platform-web-test" ||
      body.get("client_secret") !== "synthetic-test-client-secret" ||
      record.challenge !==
        createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url") ||
      body.get("redirect_uri") !== `${web}/auth/callback`
    )
      return json(400, { error: "invalid_grant" });
    const id = randomUUID();
    const token = randomUUID();
    sessions.set(token, { id, role: record.role, mode: "normal" });
    const now = Math.floor(Date.now() / 1000);
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          iss: origin,
          aud: "platform-web-test",
          sub: id,
          nonce: record.nonce,
          iat: now,
          exp: now + 900,
        }),
      ).toString("base64url"),
    ].join(".");
    const idToken = `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
    return json(200, {
      access_token: token,
      id_token: idToken,
      token_type: "Bearer",
      expires_in: 900,
    });
  }
  const session = sessions.get(request.headers.authorization?.replace(/^Bearer /, ""));
  if (!session || session.mode === "expired")
    return json(401, { error: { code: "AUTH_UNAUTHENTICATED" } });
  if (url.pathname === "/api/v1/session") return json(200, { user: { id: session.id } });
  if (session.mode === "unavailable") return json(503, {});
  if (url.pathname === "/api/v1/workspaces")
    return json(200, { items: session.mode === "empty" ? [] : workspaces });
  const workspace = workspaces.find((w) => url.pathname === `/api/v1/workspaces/${w.id}`);
  if (workspace) return json(200, workspace);
  if (url.pathname === "/api/v1/cases")
    return json(200, {
      items:
        session.mode === "revoked"
          ? []
          : cases.filter((c) => c.workspaceId === url.searchParams.get("workspaceId")),
      page: { nextCursor: null, hasMore: false },
    });
  const found = cases.find(
    (c) =>
      url.pathname === `/api/v1/cases/${c.id}` ||
      url.pathname === `/api/v1/cases/${c.id}/access`,
  );
  if (found && session.mode !== "revoked")
    return json(
      200,
      url.pathname.endsWith("/access")
        ? {
            caseId: found.id,
            workspaceId: found.workspaceId,
            permissions: {
              view: true,
              update: session.role === "owner",
              createInvestigation: session.role === "owner",
              manageMembers: session.role === "owner",
            },
          }
        : found,
    );
  return json(404, { error: { code: "CASE_NOT_FOUND" } });
});
server.listen(43101, "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
