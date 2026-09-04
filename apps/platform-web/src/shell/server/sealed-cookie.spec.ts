import { describe, expect, it } from "vitest";
import { seal, unseal, type Session } from "./sealed-cookie";
const key = new Uint8Array(32).fill(7);
const origin = "https://platform.example.test";
const session: Session = {
  kind: "session",
  token: "synthetic-private-token",
  userId: "synthetic-user",
  expiresAt: Math.floor(Date.now() / 1000) + 60,
};
describe("encrypted web session", () => {
  it("encrypts contents and checks session type, origin and key", async () => {
    const sealed = await seal(session, key, origin);
    expect(sealed).not.toContain(session.token);
    expect(await unseal(sealed, "session", key, origin)).toMatchObject(session);
    expect(await unseal(sealed, "login", key, origin)).toBeNull();
    expect(await unseal(sealed, "session", key, "https://other.example.test")).toBeNull();
    expect(await unseal(sealed, "session", new Uint8Array(32), origin)).toBeNull();
    expect(
      await unseal(sealed.slice(0, -10) + "tamperedxx", "session", key, origin),
    ).toBeNull();
  });
  it("rejects expired, absent and oversized sessions", async () => {
    expect(
      await unseal(
        await seal({ ...session, expiresAt: 1 }, key, origin),
        "session",
        key,
        origin,
      ),
    ).toBeNull();
    expect(await unseal(undefined, "session", key, origin)).toBeNull();
    await expect(
      seal({ ...session, token: "x".repeat(8000) }, key, origin),
    ).rejects.toThrow("capacity");
  });
});
