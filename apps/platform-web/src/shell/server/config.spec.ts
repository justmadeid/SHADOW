import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { webConfig } from "./config";
afterEach(() => vi.unstubAllEnvs());
function configure() {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("WEB_ORIGIN", "http://localhost:3000");
  vi.stubEnv("WEB_PLATFORM_API_URL", "http://localhost:3001/api/v1");
  vi.stubEnv("WEB_OIDC_ISSUER", "https://identity.example.test");
  vi.stubEnv("WEB_OIDC_CLIENT_ID", "web-client");
  vi.stubEnv("WEB_SESSION_KEY", "ab".repeat(32));
}
describe("web trust configuration", () => {
  it("permits loopback HTTP only in development", () => {
    configure();
    expect(webConfig().secure).toBe(false);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => webConfig()).toThrow();
  });
  it.each([
    "http://external.example.test",
    "https://user:password@example.test",
    "https://example.test?redirect=other",
    "file:///tmp/config",
  ])("rejects unsafe configured endpoints %s", (value) => {
    configure();
    vi.stubEnv("WEB_PLATFORM_API_URL", value);
    expect(() => webConfig()).toThrow();
  });
  it("has no default session secret", () => {
    configure();
    vi.stubEnv("WEB_SESSION_KEY", "");
    expect(() => webConfig()).toThrow();
  });
  it("sets secure cookies for HTTPS origins", () => {
    configure();
    vi.stubEnv("WEB_ORIGIN", "https://platform.example.test");
    expect(webConfig().secure).toBe(true);
  });
});
