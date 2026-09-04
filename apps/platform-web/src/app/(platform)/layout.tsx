import { Suspense } from "react";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { safeReturnTo } from "@intelligence/contracts";
import { PlatformShell } from "../../shell/platform-shell";
import { verifiedSession } from "../../shell/server/session";
export const dynamic = "force-dynamic";
export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let authenticated = false;
  try {
    authenticated = Boolean(await verifiedSession());
  } catch {
    /* Fail closed; login explains configuration/availability. */
  }
  if (!authenticated)
    redirect(
      `/login?returnTo=${encodeURIComponent(safeReturnTo((await headers()).get("x-shell-return")))}`,
    );
  return (
    <Suspense fallback={<p role="status">Loading protected shell…</p>}>
      <PlatformShell>{children}</PlatformShell>
    </Suspense>
  );
}
