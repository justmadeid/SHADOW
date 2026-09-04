"use client";
import { createContext, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  QueryClient,
  QueryCache,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, createApiClient } from "@intelligence/api-client";
import {
  PRODUCTS,
  parseShellContext,
  productHref,
  type CaseAccess,
  type CaseSummary,
  type Product,
  type ShellContext,
  type WorkspaceSummary,
} from "@intelligence/contracts";

const api = createApiClient({ baseUrl: "/api/platform" });
type ActiveContext = {
  workspace: WorkspaceSummary;
  case: CaseSummary;
  access: CaseAccess;
};
const Context = createContext<ActiveContext | null>(null);
export function useCaseContext() {
  const value = useContext(Context);
  if (!value) throw new Error("An authorized Case context is required");
  return value;
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({
          onError: (error) => {
            if (
              error instanceof ApiError &&
              error.status === 401 &&
              typeof window !== "undefined"
            )
              window.dispatchEvent(new Event("platform-session-expired"));
          },
        }),
        defaultOptions: {
          queries: {
            retry: false,
            staleTime: 0,
            gcTime: 0,
            refetchOnWindowFocus: "always",
            refetchOnMount: "always",
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <SessionShell>{children}</SessionShell>
    </QueryClientProvider>
  );
}
function SessionShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const query = useSearchParams();
  const client = useQueryClient();
  const [signedOut, setSignedOut] = useState(false);
  const [tabId] = useState(() => crypto.randomUUID());
  const session = useQuery({
    queryKey: ["session"],
    queryFn: ({ signal }) => api.session(signal),
    enabled: !signedOut,
    refetchInterval: 30_000,
  });
  useEffect(() => {
    void client.invalidateQueries({ queryKey: ["session"] });
    void client.invalidateQueries({ queryKey: ["active-case"] });
  }, [pathname, client]);
  useEffect(() => {
    if (!session.data) return;
    const timer = setTimeout(
      () => {
        setSignedOut(true);
        client.clear();
      },
      Math.max(0, session.data.expiresAt * 1000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [session.data, client]);
  useEffect(() => {
    const channel = new BroadcastChannel("platform-session");
    const end = () => {
      setSignedOut(true);
      client.clear();
    };
    channel.onmessage = (event) => {
      if (event.data?.tabId !== tabId) end();
    };
    window.addEventListener("platform-session-expired", end);
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", restore);
    return () => {
      channel.close();
      window.removeEventListener("platform-session-expired", end);
      window.removeEventListener("pageshow", restore);
    };
  }, [client, tabId]);
  const logout = () => {
    const channel = new BroadcastChannel("platform-session");
    channel.postMessage({ tabId });
    channel.close();
    // Let the native POST complete before unmounting its form. Navigation drops
    // this tab's in-memory cache; other tabs clear immediately via the channel.
  };
  if (
    signedOut ||
    (session.error instanceof ApiError && [401, 403].includes(session.error.status))
  )
    return (
      <Notice title="Session ended">
        <p>Sign in again to reopen an authorized context.</p>
        <a
          className="button primary"
          href={`/login?returnTo=${encodeURIComponent(pathname + "?" + query)}`}
        >
          Sign in
        </a>
      </Notice>
    );
  if (session.isError)
    return (
      <Notice title="Platform unavailable">
        <p>{session.error.message}</p>
        <button onClick={() => void session.refetch()}>Retry connection</button>
        <form action="/auth/logout" method="post">
          <button onClick={logout}>Sign out</button>
        </form>
      </Notice>
    );
  if (session.isPending)
    return (
      <Notice title="Checking session">
        <p role="status">Verifying your current access…</p>
      </Notice>
    );
  let selected: ShellContext;
  try {
    selected = parseShellContext(new URLSearchParams(query));
  } catch {
    return (
      <Notice title="Invalid context">
        <p>This link does not contain a valid Workspace and Case context.</p>
        <Link className="button" href="/shadow">
          Choose context
        </Link>
      </Notice>
    );
  }
  const product = PRODUCTS.find((p) => pathname === `/${p.toLowerCase()}`) ?? "SHADOW";
  return (
    <div className="platform-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <header className="command-bar">
        <Link href={productHref(product)} className="wordmark">
          INTELLIGENCE<span>PLATFORM</span>
        </Link>
        <div className="command-label">Protected workspace</div>
        <span className="session-status">● Signed in</span>
        <form action="/auth/logout" method="post" onSubmit={logout}>
          <button className="quiet">Sign out</button>
        </form>
      </header>
      <div className="shell-body">
        <nav className="product-rail" aria-label="Products">
          {PRODUCTS.map((p) => (
            <Link
              key={p}
              href={productHref(p, selected)}
              prefetch={false}
              aria-current={product === p ? "page" : undefined}
              aria-label={p}
              title={p}
            >
              <span aria-hidden="true">{p.slice(0, 1)}</span>
              <small>{p}</small>
            </Link>
          ))}
        </nav>
        <main id="main-content" className="shell-main">
          <WorkspaceContext
            key={`${session.data.user.id}:${selected.workspaceId ?? "none"}`}
            product={product}
            selected={selected}
          >
            {children}
          </WorkspaceContext>
        </main>
      </div>
      <footer className="status-strip">
        <span>SHARED PLATFORM CORE</span>
        <span>Access enforced by the Platform API</span>
      </footer>
    </div>
  );
}
function WorkspaceContext({
  product,
  selected,
  children,
}: {
  product: Product;
  selected: ShellContext;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const list = useQuery({
    queryKey: ["workspaces"],
    queryFn: ({ signal }) => api.workspaces(signal),
    refetchInterval: 30_000,
  });
  const workspace = useQuery({
    queryKey: ["workspace", selected.workspaceId],
    queryFn: async ({ signal }) => {
      const item = await api.workspace(selected.workspaceId!, signal);
      if (item.id !== selected.workspaceId) throw new ApiError(404);
      return item;
    },
    enabled: Boolean(selected.workspaceId),
    refetchInterval: 30_000,
  });
  if (list.isError)
    return <QueryFailure error={list.error} retry={() => void list.refetch()} />;
  if (list.isPending) return <Loading label="Loading authorized Workspaces…" />;
  return (
    <>
      <section className="context-bar" aria-label="Workspace context">
        <label>
          Workspace
          <select
            aria-label="Workspace"
            value={selected.workspaceId ?? ""}
            onChange={(e) =>
              router.push(
                productHref(
                  product,
                  e.target.value ? { workspaceId: e.target.value } : {},
                ),
              )
            }
          >
            <option value="">Select Workspace</option>
            {list.data.items
              .filter((w) => !(workspace.isError && w.id === selected.workspaceId))
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </label>
        <span className="context-hint">Changing Workspace clears the active Case.</span>
      </section>
      {!selected.workspaceId ? (
        <section className="empty-state">
          <p className="eyebrow">{product} / CONTEXT</p>
          <h1>
            {list.data.items.length ? "Choose your Workspace" : "No Workspaces available"}
          </h1>
          <p>
            {list.data.items.length
              ? "Select an authorized Workspace to find your Cases."
              : "Ask your administrator to add you to a Workspace."}
          </p>
        </section>
      ) : workspace.isError ? (
        <QueryFailure error={workspace.error} retry={() => void workspace.refetch()} />
      ) : workspace.isPending || !workspace.isFetchedAfterMount ? (
        <Loading label="Checking Workspace access…" />
      ) : (
        <CaseContext
          key={`${selected.workspaceId}:${selected.caseId ?? "none"}`}
          product={product}
          workspace={workspace.data}
          selected={selected}
        >
          {children}
        </CaseContext>
      )}
    </>
  );
}
function CaseContext({
  product,
  workspace,
  selected,
  children,
}: {
  product: Product;
  workspace: WorkspaceSummary;
  selected: ShellContext;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [cursor, setCursor] = useState<string | null>(null);
  const page = useQuery({
    queryKey: ["cases", workspace.id, cursor],
    queryFn: async ({ signal }) => {
      const result = await api.cases(workspace.id, cursor, signal);
      if (result.items.some((item) => item.workspaceId !== workspace.id))
        throw new ApiError(404);
      return result;
    },
    refetchInterval: 30_000,
  });
  const current = useQuery({
    queryKey: ["active-case", workspace.id, selected.caseId],
    enabled: Boolean(selected.caseId),
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const [item, access] = await Promise.all([
        api.case(selected.caseId!, signal),
        api.caseAccess(selected.caseId!, signal),
      ]);
      if (
        item.id !== selected.caseId ||
        item.workspaceId !== workspace.id ||
        access.caseId !== item.id ||
        access.workspaceId !== workspace.id ||
        !access.permissions.view
      )
        throw new ApiError(404);
      return { workspace, case: item, access };
    },
  });
  return (
    <>
      <section className="case-picker" aria-label="Case context">
        <label>
          Case
          <select
            aria-label="Case"
            value={selected.caseId ?? ""}
            disabled={page.isPending || page.isError}
            onChange={(e) =>
              router.push(
                productHref(product, {
                  workspaceId: workspace.id,
                  ...(e.target.value ? { caseId: e.target.value } : {}),
                }),
              )
            }
          >
            <option value="">Select Case</option>
            {selected.caseId &&
              (current.isError ||
                !page.data?.items.some((c) => c.id === selected.caseId)) && (
                <option value={selected.caseId}>Selected Case</option>
              )}
            {!page.isError &&
              page.data?.items
                .filter((c) => !(current.isError && c.id === selected.caseId))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.title}
                  </option>
                ))}
          </select>
        </label>
        {!page.isError && page.data?.page.hasMore && (
          <button onClick={() => setCursor(page.data!.page.nextCursor)}>
            Next Cases
          </button>
        )}
        {cursor && <button onClick={() => setCursor(null)}>First Cases</button>}
      </section>
      {page.isError ? (
        <QueryFailure error={page.error} retry={() => void page.refetch()} />
      ) : page.isPending ? (
        <Loading label="Loading authorized Cases…" />
      ) : !selected.caseId ? (
        <section className="empty-state">
          <p className="eyebrow">
            {product} / {workspace.name}
          </p>
          <h1>
            {page.data.items.length ? "Choose a Case to continue" : "No accessible Cases"}
          </h1>
          <p>
            {page.data.items.length
              ? "Your Case context stays with you across SHADOW, ECHO and SPECTRA."
              : "Only authorized Cases appear here. Case creation arrives in P1-010."}
          </p>
        </section>
      ) : current.isError ? (
        <QueryFailure error={current.error} retry={() => void current.refetch()} />
      ) : current.isPending || !current.isFetchedAfterMount ? (
        <Loading label="Checking Case access…" />
      ) : (
        <Context.Provider value={current.data}>
          <section className="active-context" aria-label="Active Case">
            <div>
              <p className="eyebrow">ACTIVE CASE / {current.data.case.code}</p>
              <h2>{current.data.case.title}</h2>
            </div>
            <div className="badges">
              <span className="badge">{current.data.case.classification}</span>
              <span className="badge">{current.data.case.status}</span>
            </div>
          </section>
          {children}
        </Context.Provider>
      )}
    </>
  );
}
function QueryFailure({ error, retry }: { error: Error; retry: () => void }) {
  return (
    <section className="empty-state" role="alert">
      <p className="eyebrow">ACCESS CHECK</p>
      <h1>
        {error instanceof ApiError && [401, 403, 404].includes(error.status)
          ? "Context unavailable"
          : "Unable to load context"}
      </h1>
      <p>{error.message}</p>
      {error instanceof ApiError && error.status === 401 ? (
        <a className="button" href="/login">
          Sign in again
        </a>
      ) : (
        <button onClick={retry}>Retry access check</button>
      )}
    </section>
  );
}
function Loading({ label }: { label: string }) {
  return (
    <section className="empty-state" role="status">
      <span className="loading-mark" aria-hidden="true" />
      <p>{label}</p>
    </section>
  );
}
export function Notice({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-panel">
        <p className="eyebrow">INTELLIGENCE PLATFORM</p>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}
export function ProductLanding({
  product,
  description,
}: {
  product: Product;
  description: string;
}) {
  const context = useCaseContext();
  return (
    <section className="product-content">
      <p className="eyebrow">{product} / PROTECTED SHELL</p>
      <h1>{product}</h1>
      <p className="lead">{description}</p>
      <div className="capability-panel">
        <h2>Current Case access</h2>
        <dl>
          <div>
            <dt>View Case</dt>
            <dd>Allowed</dd>
          </div>
          <div>
            <dt>Update Case</dt>
            <dd>{context.access.permissions.update ? "Allowed" : "Not granted"}</dd>
          </div>
          <div>
            <dt>Create Investigation</dt>
            <dd>
              {context.access.permissions.createInvestigation ? "Allowed" : "Not granted"}
            </dd>
          </div>
          <div>
            <dt>Manage membership</dt>
            <dd>
              {context.access.permissions.manageMembers ? "Allowed" : "Not granted"}
            </dd>
          </div>
        </dl>
      </div>
      <p className="scope-note">
        This shell shares only authenticated Workspace and Case context. Product tools and
        local interaction state remain separate.
      </p>
    </section>
  );
}
