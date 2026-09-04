import "server-only";
import { cookies } from "next/headers";
import { webConfig } from "./config";
import { unseal } from "./sealed-cookie";

export const cookieNames = (secure: boolean) => ({
  session: secure ? "__Host-platform-session" : "platform-session",
  login: secure ? "__Host-platform-login" : "platform-login",
});
export const cookieOptions = (secure: boolean, expiresAt: number) => ({
  httpOnly: true,
  secure,
  sameSite: "lax" as const,
  path: "/",
  expires: new Date(expiresAt * 1000),
});

export async function readSession() {
  const config = webConfig();
  return unseal(
    (await cookies()).get(cookieNames(config.secure).session)?.value,
    "session",
    config.key,
    config.origin,
  );
}

export async function upstream(path: string, token: string) {
  const config = webConfig();
  return fetch(`${config.api}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": crypto.randomUUID(),
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
}

export async function verifiedSession() {
  const session = await readSession();
  if (!session) return null;
  const response = await upstream("/session", session.token);
  if ([401, 403].includes(response.status)) return null;
  if (!response.ok) throw new Error("Session service unavailable");
  const body = await response.json();
  if (body?.user?.id !== session.userId) return null;
  return session;
}
