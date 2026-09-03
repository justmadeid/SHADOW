import type { AuthenticatedPrincipal } from "./principal.js";

const MAX_ACCESS_TOKEN_LENGTH = 16_384;

export interface AccessTokenVerifier {
  verify(accessToken: string): Promise<AuthenticatedPrincipal>;
}

export class AccessTokenVerificationError extends Error {
  constructor() {
    super("Access token verification failed.");
    this.name = "AccessTokenVerificationError";
  }
}

export function parseBearerAccessToken(authorizationHeader: string | undefined): string {
  if (!authorizationHeader || authorizationHeader.length > MAX_ACCESS_TOKEN_LENGTH) {
    throw new AccessTokenVerificationError();
  }

  const match = /^Bearer[\t ]+([^\s,]+)$/i.exec(authorizationHeader);
  const accessToken = match?.[1];

  if (!accessToken) {
    throw new AccessTokenVerificationError();
  }

  return accessToken;
}
