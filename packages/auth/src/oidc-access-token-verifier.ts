import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTVerifyGetKey,
  type JWTPayload,
} from "jose";

import {
  AccessTokenVerificationError,
  type AccessTokenVerifier,
} from "./access-token.js";
import type { AuthenticatedPrincipal } from "./principal.js";

export type OidcAccessTokenVerifierConfig = {
  issuer: string;
  audience: string;
  jwksUri: string;
  algorithms: readonly string[];
  serviceClientIds?: readonly string[];
  clockToleranceSeconds?: number;
};

export type OidcAccessTokenVerifierDependencies = {
  keyResolver?: JWTVerifyGetKey;
};

function stringClaim(payload: JWTPayload, claim: string): string | undefined {
  const value = payload[claim];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function clientIdFrom(payload: JWTPayload): string | undefined {
  const clientId = stringClaim(payload, "client_id");
  const authorizedParty = stringClaim(payload, "azp");

  if (clientId && authorizedParty && clientId !== authorizedParty) {
    throw new AccessTokenVerificationError();
  }

  return clientId ?? authorizedParty;
}

export function createOidcAccessTokenVerifier(
  config: OidcAccessTokenVerifierConfig,
  dependencies: OidcAccessTokenVerifierDependencies = {},
): AccessTokenVerifier {
  if (config.algorithms.length === 0) {
    throw new Error("At least one OIDC signing algorithm must be configured.");
  }

  const serviceClientIds = new Set(config.serviceClientIds ?? []);
  const keyResolver =
    dependencies.keyResolver ??
    createRemoteJWKSet(new URL(config.jwksUri), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 600_000,
    });

  return {
    async verify(accessToken: string): Promise<AuthenticatedPrincipal> {
      try {
        const { payload } = await jwtVerify(accessToken, keyResolver, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: [...config.algorithms],
          requiredClaims: ["sub", "iat", "exp"],
          clockTolerance: config.clockToleranceSeconds ?? 5,
        });

        const subject = stringClaim(payload, "sub");
        if (!subject) {
          throw new AccessTokenVerificationError();
        }

        const clientId = clientIdFrom(payload);
        if (clientId && serviceClientIds.has(clientId)) {
          return {
            kind: "SERVICE",
            subject,
            serviceId: clientId,
            clientId,
            issuer: config.issuer,
          };
        }

        return {
          kind: "USER",
          subject,
          userId: subject,
          issuer: config.issuer,
        };
      } catch {
        throw new AccessTokenVerificationError();
      }
    },
  };
}
