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
const now = "2026-09-06T00:00:00.000Z";
const baseCases = [
  {
    id: caseId,
    workspaceId,
    code: "CASE-SYNTHETIC",
    title: "Synthetic investigation",
    description: "Synthetic Case used only by browser tests.",
    classification: "SENSITIVE",
    status: "ACTIVE",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    archivedAt: null,
  },
  {
    id: secondCaseId,
    workspaceId: secondWorkspaceId,
    code: "CASE-SECOND",
    title: "Second workspace case",
    description: null,
    classification: "INTERNAL",
    status: "DRAFT",
    revision: 1,
    createdAt: now,
    updatedAt: now,
    closedAt: null,
    archivedAt: null,
  },
];
const workspaces = [
  { id: workspaceId, name: "Synthetic Workspace" },
  { id: secondWorkspaceId, name: "Second Workspace" },
];

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, origin);
  const json = (status, body, extraHeaders = {}) => {
    response.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extraHeaders,
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
    sessions.set(token, {
      id,
      role: record.role,
      mode: "normal",
      cases: structuredClone(baseCases),
      investigations: [
        {
          id: "01900000-0000-7000-8000-000000000005",
          workspaceId,
          caseId,
          title: "Initial assessment",
          objective: "Establish the initial investigative scope.",
          status: "ACTIVE",
          revision: 1,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          archivedAt: null,
        },
      ],
      replays: new Map(),
    });
    const issuedAt = Math.floor(Date.now() / 1000);
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: "RS256", kid: "fixture" })).toString("base64url"),
      Buffer.from(
        JSON.stringify({
          iss: origin,
          aud: "platform-web-test",
          sub: id,
          nonce: record.nonce,
          iat: issuedAt,
          exp: issuedAt + 900,
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
  if (url.pathname === "/api/v1/cases" && request.method === "POST") {
    const body = await readJson(request);
    if (!body || !workspaces.some((workspace) => workspace.id === body.workspaceId))
      return json(400, {});
    const key = request.headers["idempotency-key"];
    const replay = session.replays.get(key);
    if (replay) return json(201, replay);
    const created = {
      id: randomUUID(),
      workspaceId: body.workspaceId,
      code: `CASE-${session.cases.length + 1}`,
      title: body.title,
      description: body.description,
      classification: body.classification,
      status: "DRAFT",
      revision: 1,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      archivedAt: null,
    };
    session.cases.unshift(created);
    session.replays.set(key, created);
    return json(201, created, {
      etag: '"1"',
      location: `/api/v1/cases/${created.id}`,
    });
  }
  if (url.pathname === "/api/v1/cases" && request.method === "GET")
    return json(200, {
      items:
        session.mode === "revoked"
          ? []
          : session.cases.filter(
              (c) => c.workspaceId === url.searchParams.get("workspaceId"),
            ),
      page: { nextCursor: null, hasMore: false },
    });
  const requestedCaseId = url.pathname.match(/^\/api\/v1\/cases\/([^/]+)/)?.[1];
  const found = session.cases.find((c) => c.id === requestedCaseId);
  if (
    found &&
    request.method === "PATCH" &&
    url.pathname === `/api/v1/cases/${found.id}`
  ) {
    if (session.role !== "owner") return json(404, {});
    if (session.mode === "stale" || request.headers["if-match"] !== `"${found.revision}"`)
      return json(412, {});
    const body = await readJson(request);
    if (!body || found.status === "CLOSED" || found.status === "ARCHIVED")
      return json(409, {});
    Object.assign(found, body, { revision: found.revision + 1, updatedAt: now });
    return json(200, found, { etag: `"${found.revision}"` });
  }
  const action = found && url.pathname.match(/\/actions\/(close|reopen|archive)$/)?.[1];
  if (found && action && request.method === "POST") {
    if (session.role !== "owner") return json(404, {});
    if (session.mode === "stale" || request.headers["if-match"] !== `"${found.revision}"`)
      return json(412, {});
    const next =
      action === "close" && ["DRAFT", "ACTIVE"].includes(found.status)
        ? "CLOSED"
        : action === "reopen" && found.status === "CLOSED"
          ? "ACTIVE"
          : action === "archive" && found.status !== "ARCHIVED"
            ? "ARCHIVED"
            : null;
    if (!next) return json(409, {});
    found.status = next;
    found.revision += 1;
    found.updatedAt = now;
    if (next === "CLOSED") found.closedAt = now;
    if (next === "ARCHIVED") found.archivedAt = now;
    return json(200, found, { etag: `"${found.revision}"` });
  }
  if (found && url.pathname === `/api/v1/cases/${found.id}/investigations`) {
    if (request.method === "GET")
      return json(200, {
        items: session.investigations.filter((item) => item.caseId === found.id),
      });
    if (request.method === "POST") {
      if (session.role !== "owner") return json(404, {});
      if (["CLOSED", "ARCHIVED"].includes(found.status)) return json(409, {});
      const key = request.headers["idempotency-key"];
      const replay = session.replays.get(key);
      if (replay) return json(201, replay);
      const body = await readJson(request);
      if (!body) return json(400, {});
      const created = {
        id: randomUUID(),
        workspaceId: found.workspaceId,
        caseId: found.id,
        title: body.title,
        objective: body.objective,
        status: "ACTIVE",
        revision: 1,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        archivedAt: null,
      };
      session.investigations.unshift(created);
      session.replays.set(key, created);
      return json(201, created, { etag: '"1"' });
    }
  }
  if (
    found &&
    session.mode !== "revoked" &&
    request.method === "GET" &&
    [`/api/v1/cases/${found.id}`, `/api/v1/cases/${found.id}/access`].includes(
      url.pathname,
    )
  )
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
async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 8192) return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => server.close(() => process.exit(0)));
