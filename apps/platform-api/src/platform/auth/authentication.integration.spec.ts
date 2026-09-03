import type { AccessTokenVerifier, AuthenticatedPrincipal } from "@intelligence/auth";
import { Controller, Get, Inject, type INestApplication, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { Logger } from "pino";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { PlatformExceptionFilter } from "../errors/http-exception.filter.js";
import { RequestContextModule, RequestContextStore } from "../request-context/index.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "./authentication.tokens.js";
import { PublicEndpoint } from "./public-endpoint.decorator.js";

const principals: Record<string, AuthenticatedPrincipal> = {
  "valid-user": {
    kind: "USER",
    subject: "user-subject",
    userId: "user-subject",
    issuer: "https://identity.example.test",
  },
  "valid-service": {
    kind: "SERVICE",
    subject: "service-subject",
    serviceId: "connector-worker",
    clientId: "connector-worker",
    issuer: "https://identity.example.test",
  },
};

const accessTokenVerifier: AccessTokenVerifier = {
  async verify(accessToken) {
    const principal = principals[accessToken];
    if (!principal) {
      throw new Error("invalid token");
    }
    return principal;
  },
};

@Controller("auth-integration")
class AuthenticationIntegrationController {
  constructor(
    @Inject(RequestContextStore)
    private readonly requestContext: RequestContextStore,
  ) {}

  @PublicEndpoint()
  @Get("public")
  publicEndpoint() {
    return { status: "ok" };
  }

  @Get("protected")
  protectedEndpoint() {
    return { principal: this.requestContext.get().principal };
  }
}

@Module({
  imports: [RequestContextModule],
  controllers: [AuthenticationIntegrationController],
  providers: [
    { provide: ACCESS_TOKEN_VERIFIER, useValue: accessTokenVerifier },
    AuthenticationGuard,
    { provide: APP_GUARD, useExisting: AuthenticationGuard },
  ],
})
class AuthenticationIntegrationModule {}

describe("authentication HTTP boundary", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AuthenticationIntegrationModule],
    }).compile();

    app = moduleRef.createNestApplication();
    const logger = { error: vi.fn() } as unknown as Logger;
    app.useGlobalFilters(
      new PlatformExceptionFilter(moduleRef.get(RequestContextStore), logger),
    );
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
  });

  it("allows endpoints explicitly marked public", async () => {
    await request(app.getHttpServer())
      .get("/auth-integration/public")
      .expect(200, { status: "ok" });
  });

  it.each([
    ["a missing header", undefined],
    ["a malformed header", "Basic credential"],
    ["an invalid token", "Bearer invalid"],
  ])("returns the same 401 contract for %s", async (_label, header) => {
    const response = request(app.getHttpServer()).get("/auth-integration/protected");
    if (header) {
      response.set("authorization", header);
    }

    await response
      .expect("www-authenticate", "Bearer")
      .expect(401)
      .expect(({ body }) => {
        expect(body.error).toMatchObject({
          code: "AUTH_UNAUTHENTICATED",
          message: "A valid access token is required.",
        });
        expect(body.error.requestId).toEqual(expect.any(String));
      });
  });

  it.each([
    ["valid-user", "USER", "user-subject"],
    ["valid-service", "SERVICE", "connector-worker"],
  ])("propagates a verified %s principal", async (token, kind, actorId) => {
    await request(app.getHttpServer())
      .get("/auth-integration/protected")
      .set("authorization", `Bearer ${token}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body.principal.kind).toBe(kind);
        expect(body.principal.userId ?? body.principal.serviceId).toBe(actorId);
      });
  });
});
