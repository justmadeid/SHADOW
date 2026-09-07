"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@intelligence/api-client";
import {
  DATA_CLASSIFICATIONS,
  productHref,
  type CaseDetail,
  type DataClassification,
} from "@intelligence/contracts";
import { useWorkspaceContext } from "../../shell/platform-shell";

const api = createApiClient({ baseUrl: "/api/platform" });
type Panel = "create-case" | "edit-case" | "create-investigation" | null;
type CaseFormValue = {
  title: string;
  description: string | null;
  classification: DataClassification;
};

export function ShadowCaseWorkspace() {
  const context = useWorkspaceContext();
  const router = useRouter();
  const client = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [editSnapshot, setEditSnapshot] = useState<CaseDetail | null>(null);
  const createKeys = useRef(new Map<string, string>());
  const keyFor = (value: unknown) => {
    const payload = JSON.stringify(value);
    let key = createKeys.current.get(payload);
    if (!key) {
      key = crypto.randomUUID();
      createKeys.current.set(payload, key);
    }
    return key;
  };
  const [confirmAction, setConfirmAction] = useState<"close" | "archive" | null>(null);
  const active = context.case;
  const access = context.access;
  const investigations = useQuery({
    queryKey: ["investigations", active?.id],
    queryFn: async ({ signal }) => {
      const result = await api.investigations(active!.id, signal);
      if (
        result.items.some(
          (item) =>
            item.caseId !== active!.id || item.workspaceId !== context.workspace.id,
        )
      )
        throw new Error("Investigation scope could not be verified.");
      return result;
    },
    enabled: Boolean(active),
    refetchInterval: 30_000,
  });
  const refreshCase = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["cases", context.workspace.id] }),
      client.invalidateQueries({ queryKey: ["active-case"] }),
    ]);
  };
  const createCase = useMutation({
    mutationFn: (value: CaseFormValue) =>
      api.createCase(
        { workspaceId: context.workspace.id, ...value },
        keyFor({ workspaceId: context.workspace.id, ...value }),
      ),
    onSuccess: async (created) => {
      createKeys.current.clear();
      await refreshCase();
      setPanel(null);
      router.push(
        productHref("SHADOW", {
          workspaceId: context.workspace.id,
          caseId: created.id,
        }),
      );
    },
    onError: handleSessionError,
  });
  const updateCase = useMutation({
    mutationFn: (value: CaseFormValue) =>
      api.updateCase(editSnapshot!.id, value, editSnapshot!.revision),
    onSuccess: async () => {
      await refreshCase();
      setPanel(null);
    },
    onError: handleSessionError,
  });
  const transitionCase = useMutation({
    mutationFn: (action: "close" | "reopen" | "archive") =>
      api.transitionCase(active!.id, action, active!.revision),
    onSuccess: async () => {
      await refreshCase();
      setConfirmAction(null);
    },
    onError: handleSessionError,
  });
  const createInvestigation = useMutation({
    mutationFn: (value: { title: string; objective: string }) =>
      api.createInvestigation(
        active!.id,
        value,
        keyFor({ caseId: active!.id, ...value }),
      ),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["investigations", active!.id] });
      createKeys.current.clear();
      setPanel(null);
    },
    onError: handleSessionError,
  });
  const busy =
    createCase.isPending ||
    updateCase.isPending ||
    transitionCase.isPending ||
    createInvestigation.isPending;

  return (
    <section className="shadow-workspace" aria-label="SHADOW Case workspace">
      <header className="mission-header">
        <div>
          <p className="eyebrow">SHADOW / CASE COMMAND CENTER</p>
          <h1>SHADOW</h1>
          <p className="lead">
            {active
              ? `${active.title} · ${active.code} · Revision ${active.revision}`
              : `Cases · ${context.workspace.name}`}
          </p>
        </div>
        <button className="button primary" onClick={() => setPanel("create-case")}>
          New Case
        </button>
      </header>

      <CaseList active={active} />

      {panel === "create-case" && (
        <CaseForm
          title="Create Case"
          submitLabel="Create Case"
          pending={createCase.isPending}
          error={createCase.error}
          onCancel={() => setPanel(null)}
          onSubmit={(value) => createCase.mutate(value)}
        />
      )}

      {active && access && (
        <>
          <section className="case-command-grid">
            <article className="case-detail-card">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">CASE OVERVIEW</p>
                  <h2>Case details</h2>
                </div>
                <div className="badges">
                  <span className="badge">{active.classification}</span>
                  <span className="badge">{active.status}</span>
                </div>
              </div>
              <dl className="case-metadata">
                <div>
                  <dt>Description</dt>
                  <dd>{active.description ?? "No description provided."}</dd>
                </div>
                <div>
                  <dt>Last updated</dt>
                  <dd>{formatInstant(active.updatedAt)}</dd>
                </div>
              </dl>
              {access.permissions.update ? (
                <div className="case-actions">
                  {active.status !== "ARCHIVED" && active.status !== "CLOSED" && (
                    <button
                      onClick={() => {
                        setEditSnapshot(active);
                        updateCase.reset();
                        setPanel("edit-case");
                      }}
                    >
                      Edit metadata
                    </button>
                  )}
                  {(active.status === "DRAFT" || active.status === "ACTIVE") && (
                    <button onClick={() => setConfirmAction("close")}>Close Case</button>
                  )}
                  {active.status === "CLOSED" && (
                    <button
                      onClick={() => transitionCase.mutate("reopen")}
                      disabled={busy}
                    >
                      Reopen Case
                    </button>
                  )}
                  {active.status !== "ARCHIVED" && (
                    <button
                      className="danger"
                      onClick={() => setConfirmAction("archive")}
                    >
                      Archive Case
                    </button>
                  )}
                </div>
              ) : (
                <p className="scope-note">You have read-only access to this Case.</p>
              )}
              <MutationError error={transitionCase.error} />
            </article>

            <InvestigationPanel
              caseDetail={active}
              canCreate={access.permissions.createInvestigation}
              loading={investigations.isPending}
              error={investigations.error}
              items={investigations.data?.items ?? []}
              onCreate={() => setPanel("create-investigation")}
            />
          </section>

          {panel === "edit-case" && editSnapshot && (
            <CaseForm
              key={`${editSnapshot.id}:${editSnapshot.revision}`}
              title="Edit Case metadata"
              submitLabel="Save changes"
              initial={editSnapshot}
              pending={updateCase.isPending}
              error={updateCase.error}
              onCancel={() => setPanel(null)}
              onSubmit={(value) => updateCase.mutate(value)}
            />
          )}
          {panel === "edit-case" &&
            updateCase.error instanceof ApiError &&
            updateCase.error.status === 412 && (
              <button
                onClick={async () => {
                  await refreshCase();
                  setPanel(null);
                  updateCase.reset();
                }}
              >
                Reload current version (discard draft)
              </button>
            )}
          {panel === "create-investigation" && (
            <InvestigationForm
              pending={createInvestigation.isPending}
              error={createInvestigation.error}
              onCancel={() => setPanel(null)}
              onSubmit={(value) => createInvestigation.mutate(value)}
            />
          )}
          {confirmAction && (
            <Confirmation
              action={confirmAction}
              caseCode={active.code}
              pending={transitionCase.isPending}
              onCancel={() => setConfirmAction(null)}
              onConfirm={() => transitionCase.mutate(confirmAction)}
            />
          )}
        </>
      )}
    </section>
  );
}

function CaseList({ active }: { active: CaseDetail | null }) {
  const context = useWorkspaceContext();
  return (
    <section className="case-list-card" aria-label="Accessible Cases">
      <div className="section-heading">
        <div>
          <p className="eyebrow">AUTHORIZED SCOPE</p>
          <h2>Accessible Cases</h2>
        </div>
        <span>{context.cases.items.length} on this page</span>
      </div>
      {context.cases.items.length ? (
        <div className="case-table-wrap">
          <table className="case-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Classification</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {context.cases.items.map((item) => (
                <tr
                  key={item.id}
                  className={active?.id === item.id ? "selected" : undefined}
                >
                  <td>
                    <strong>{item.title}</strong>
                    <small>{item.code}</small>
                  </td>
                  <td>{item.classification}</td>
                  <td>{item.status}</td>
                  <td>
                    <Link
                      className="table-link"
                      href={productHref("SHADOW", {
                        workspaceId: context.workspace.id,
                        caseId: item.id,
                      })}
                    >
                      {active?.id === item.id ? "Open" : "View"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="compact-empty">
          <h3>No accessible Cases</h3>
          <p>Create the first Case in this Workspace.</p>
        </div>
      )}
    </section>
  );
}

function CaseForm(props: {
  title: string;
  submitLabel: string;
  initial?: CaseDetail;
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (value: CaseFormValue) => void;
}) {
  return (
    <section className="command-panel" aria-label={props.title}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">CASE COMMAND</p>
          <h2>{props.title}</h2>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          props.onSubmit({
            title: String(data.get("title")),
            description: String(data.get("description")).trim() || null,
            classification: String(data.get("classification")) as DataClassification,
          });
        }}
      >
        <label>
          Title
          <input
            name="title"
            required
            minLength={3}
            maxLength={200}
            defaultValue={props.initial?.title}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            maxLength={4000}
            rows={4}
            defaultValue={props.initial?.description ?? ""}
          />
        </label>
        <label>
          Classification
          <select
            name="classification"
            defaultValue={props.initial?.classification ?? "INTERNAL"}
          >
            {DATA_CLASSIFICATIONS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <MutationError error={props.error} />
        <div className="form-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={props.pending}>
            {props.pending ? "Saving…" : props.submitLabel}
          </button>
        </div>
      </form>
    </section>
  );
}

function InvestigationPanel(props: {
  caseDetail: CaseDetail;
  canCreate: boolean;
  loading: boolean;
  error: Error | null;
  items: Array<{ id: string; title: string; objective: string; status: string }>;
  onCreate: () => void;
}) {
  const mutable = !["CLOSED", "ARCHIVED"].includes(props.caseDetail.status);
  return (
    <article className="investigation-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">BRANCHES</p>
          <h2>Investigations</h2>
        </div>
        {props.canCreate && mutable && (
          <button onClick={props.onCreate}>New Investigation</button>
        )}
      </div>
      {props.loading ? (
        <p role="status">Loading Investigations…</p>
      ) : props.error ? (
        <MutationError error={props.error} />
      ) : props.items.length ? (
        <ul className="investigation-list">
          {props.items.map((item) => (
            <li key={item.id}>
              <div>
                <strong>{item.title}</strong>
                <p>{item.objective}</p>
              </div>
              <span className="badge">{item.status}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="compact-empty">
          <h3>No Investigations yet</h3>
          <p>Create a focused branch with a clear objective.</p>
        </div>
      )}
    </article>
  );
}

function InvestigationForm(props: {
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (value: { title: string; objective: string }) => void;
}) {
  return (
    <section className="command-panel" aria-label="Create Investigation">
      <div className="section-heading">
        <div>
          <p className="eyebrow">INVESTIGATION COMMAND</p>
          <h2>Create Investigation</h2>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          props.onSubmit({
            title: String(data.get("title")),
            objective: String(data.get("objective")),
          });
        }}
      >
        <label>
          Title
          <input name="title" required minLength={3} maxLength={200} />
        </label>
        <label>
          Objective
          <textarea name="objective" required minLength={3} maxLength={2000} rows={4} />
        </label>
        <MutationError error={props.error} />
        <div className="form-actions">
          <button type="button" onClick={props.onCancel}>
            Cancel
          </button>
          <button className="primary" disabled={props.pending}>
            {props.pending ? "Creating…" : "Create Investigation"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Confirmation(props: {
  action: "close" | "archive";
  caseCode: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <section
      className="confirmation-panel"
      role="alertdialog"
      aria-labelledby="confirm-title"
    >
      <p className="eyebrow">CONFIRM CASE COMMAND</p>
      <h2 id="confirm-title">
        {props.action === "archive" ? "Archive" : "Close"} {props.caseCode}?
      </h2>
      <p>
        {props.action === "archive"
          ? "Archived Cases are terminal and cannot be edited or reopened."
          : "Closing stops metadata changes and new Investigations until the Case is reopened."}
      </p>
      <div className="form-actions">
        <button onClick={props.onCancel}>Cancel</button>
        <button
          className={props.action === "archive" ? "danger" : "primary"}
          disabled={props.pending}
          onClick={props.onConfirm}
        >
          {props.pending ? "Applying…" : `Confirm ${props.action}`}
        </button>
      </div>
    </section>
  );
}

function MutationError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className="mutation-error" role="alert">
      {error.message}
    </p>
  );
}
function handleSessionError(error: Error) {
  if (error instanceof ApiError && error.status === 401)
    window.dispatchEvent(new Event("platform-session-expired"));
}
function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
