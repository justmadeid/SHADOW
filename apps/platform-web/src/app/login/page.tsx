import { safeReturnTo } from "@intelligence/contracts";
import { webConfig } from "../../shell/server/config";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const returnTo = safeReturnTo(
    typeof params.returnTo === "string" ? params.returnTo : null,
  );
  let configured = false;
  try {
    webConfig();
    configured = true;
  } catch {
    /* Never expose environment values. */
  }
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">SHADOW / ECHO / SPECTRA</p>
        <h1>Investigation Intelligence Platform</h1>
        <p className="lead">
          One secure context.
          <br />
          Three investigative workspaces.
        </p>
        <div className="auth-divider" />
        <h2>Sign in to your Workspace</h2>
        <p>
          Workspace and Case access are checked by the Platform API. A saved link never
          grants access.
        </p>
        {params.error && (
          <p role="alert" className="error-text">
            Sign-in could not be completed. Please try again.
          </p>
        )}
        {configured ? (
          <a
            className="button primary"
            href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
          >
            Continue with organization SSO <span aria-hidden="true">→</span>
          </a>
        ) : (
          <p role="status" className="configuration-notice">
            Organization sign-in is not configured. Ask your administrator to configure
            the web OIDC client and Platform API connection.
          </p>
        )}
        <p className="scope-note">HttpOnly session · Tokens unavailable to JavaScript</p>
      </section>
    </main>
  );
}
