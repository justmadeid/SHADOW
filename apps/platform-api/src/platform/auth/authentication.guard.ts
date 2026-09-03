import { parseBearerAccessToken, type AccessTokenVerifier } from "@intelligence/auth";
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";

import { AppError } from "../errors/index.js";
import { RequestContextStore } from "../request-context/index.js";
import { ACCESS_TOKEN_VERIFIER } from "./authentication.tokens.js";
import { PUBLIC_ENDPOINT_METADATA } from "./public-endpoint.decorator.js";

@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(ACCESS_TOKEN_VERIFIER)
    private readonly accessTokenVerifier: AccessTokenVerifier,
    @Inject(RequestContextStore)
    private readonly requestContext: RequestContextStore,
  ) {}

  async canActivate(executionContext: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT_METADATA, [
      executionContext.getHandler(),
      executionContext.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const http = executionContext.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    response.setHeader("www-authenticate", "Bearer");

    try {
      const accessToken = parseBearerAccessToken(
        request.header("authorization") ?? undefined,
      );
      const principal = await this.accessTokenVerifier.verify(accessToken);
      this.requestContext.setPrincipal(principal);
      return true;
    } catch {
      throw new AppError({
        code: "AUTH_UNAUTHENTICATED",
        message: "A valid access token is required.",
        statusCode: 401,
      });
    }
  }
}
