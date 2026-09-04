import { EncryptJWT, jwtDecrypt } from "jose";

export type Session = {
  kind: "session";
  token: string;
  userId: string;
  expiresAt: number;
};
export type LoginTransaction = {
  kind: "login";
  verifier: string;
  state: string;
  nonce: string;
  returnTo: string;
  expiresAt: number;
};
type Payload = Session | LoginTransaction;

export async function seal(
  payload: Payload,
  key: Uint8Array,
  origin: string,
): Promise<string> {
  const value = await new EncryptJWT(payload)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer(origin)
    .setAudience(`${origin}/${payload.kind}`)
    .setIssuedAt()
    .setExpirationTime(payload.expiresAt)
    .encrypt(key);
  if (value.length > 3800) throw new Error("Session exceeds cookie capacity");
  return value;
}

export async function unseal<T extends Payload["kind"]>(
  value: string | undefined,
  kind: T,
  key: Uint8Array,
  origin: string,
): Promise<Extract<Payload, { kind: T }> | null> {
  if (!value || value.length > 3800) return null;
  try {
    const { payload: p } = await jwtDecrypt(value, key, {
      issuer: origin,
      audience: `${origin}/${kind}`,
      keyManagementAlgorithms: ["dir"],
      contentEncryptionAlgorithms: ["A256GCM"],
    });
    if (
      p.kind !== kind ||
      typeof p.expiresAt !== "number" ||
      p.expiresAt !== p.exp ||
      p.expiresAt <= Date.now() / 1000
    )
      return null;
    if (
      kind === "session" &&
      typeof p.token === "string" &&
      p.token.length > 0 &&
      typeof p.userId === "string" &&
      p.userId.length > 0
    )
      return p as Session as Extract<Payload, { kind: T }>;
    if (
      kind === "login" &&
      [p.verifier, p.state, p.nonce, p.returnTo].every(
        (v) => typeof v === "string" && v.length > 0,
      )
    )
      return p as LoginTransaction as Extract<Payload, { kind: T }>;
    return null;
  } catch {
    return null;
  }
}
