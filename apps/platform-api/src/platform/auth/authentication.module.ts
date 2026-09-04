import { createOidcAccessTokenVerifier } from "@intelligence/auth";
import { loadPlatformApiConfig } from "@intelligence/config";
import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { RequestContextModule } from "../request-context/index.js";
import { AuthenticationGuard } from "./authentication.guard.js";
import { ACCESS_TOKEN_VERIFIER } from "./authentication.tokens.js";
import { SessionController } from "./session.controller.js";

@Module({
  imports: [RequestContextModule],
  controllers: [SessionController],
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useFactory: () => {
        const config = loadPlatformApiConfig();
        return createOidcAccessTokenVerifier({
          issuer: config.OIDC_ISSUER,
          audience: config.OIDC_AUDIENCE,
          jwksUri: config.OIDC_JWKS_URI,
          algorithms: config.OIDC_ALLOWED_ALGORITHMS,
          serviceClientIds: config.OIDC_SERVICE_CLIENT_IDS,
        });
      },
    },
    AuthenticationGuard,
    {
      provide: APP_GUARD,
      useExisting: AuthenticationGuard,
    },
  ],
})
export class AuthenticationModule {}
