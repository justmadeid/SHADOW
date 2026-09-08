"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, createApiClient } from "@intelligence/api-client";
import {
  RESOLUTION_REASON_CODES,
  isResourceId,
  productHref,
  shadowTargetHref,
  type Candidate,
  type EntityMatchView,
  type ResolutionReasonCode,
} from "@intelligence/contracts";
import { useCaseContext } from "../../shell/platform-shell";
import { ErrorNotice, humanize } from "./target-workspace";

const api = createApiClient({ baseUrl: "/api/platform" });

export function TargetProfile({
  caseId,
  subjectId,
}: {
  caseId: string;
  subjectId: string;
}) {
  const context = useCaseContext();
  const query = useSearchParams();
  const router = useRouter();
  const client = useQueryClient();
  const resolutionId = query.get("resolutionId");
  const validResolutionId =
    resolutionId && isResourceId(resolutionId) ? resolutionId : null;
  const scopeValid =
    caseId === context.case.id &&
    isResourceId(subjectId) &&
    (!resolutionId || Boolean(validResolutionId));
  const profile = useQuery({
    queryKey: ["target-profile", caseId, subjectId],
    enabled: scopeValid,
    queryFn: async ({ signal }) => {
      const result = await api.targetProfile(caseId, subjectId, signal);
      if (
        result.id !== subjectId ||
        result.caseId !== caseId ||
        result.workspaceId !== context.workspace.id
      )
        throw new ApiError(404);
      return result;
    },
    refetchInterval: 30_000,
  });
  const currentResolution = useQuery({
    queryKey: ["subject-resolution", subjectId],
    enabled:
      scopeValid && !validResolutionId && profile.data?.subject.status === "RESOLVING",
    queryFn: ({ signal }) => api.subjectResolution(subjectId, signal),
  });
  useEffect(() => {
    if (!currentResolution.data) return;
    router.replace(
      shadowTargetHref({
        workspaceId: context.workspace.id,
        caseId,
        subjectId,
        resolutionId: currentResolution.data.id,
      }),
    );
  }, [caseId, context.workspace.id, currentResolution.data, router, subjectId]);
  const seed = useQuery({
    queryKey: ["subject-seed", subjectId],
    enabled: scopeValid && Boolean(profile.data?.subject.seed),
    queryFn: ({ signal }) => api.subjectSeed(subjectId, signal),
  });
  const resolution = useQuery({
    queryKey: ["resolution", validResolutionId],
    enabled: Boolean(validResolutionId),
    queryFn: async ({ signal }) => {
      const result = await api.resolution(validResolutionId!, signal);
      if (
        result.subjectId !== subjectId ||
        result.caseId !== caseId ||
        result.workspaceId !== context.workspace.id
      )
        throw new ApiError(404);
      return result;
    },
    refetchInterval: 15_000,
  });
  const candidates = useQuery({
    queryKey: ["candidates", validResolutionId],
    enabled: Boolean(validResolutionId),
    queryFn: ({ signal }) => api.candidates(validResolutionId!, signal),
    refetchInterval: 15_000,
  });
  const matches = useQuery({
    queryKey: ["matches", validResolutionId],
    enabled: Boolean(validResolutionId),
    queryFn: ({ signal }) => api.matches(validResolutionId!, signal),
    refetchInterval: 15_000,
  });
  const start = useMutation({
    mutationFn: () =>
      api.startResolution(subjectId, profile.data!.subject.revision, crypto.randomUUID()),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: ["target-profile", caseId, subjectId] });
      router.replace(
        shadowTargetHref({
          workspaceId: context.workspace.id,
          caseId,
          subjectId,
          resolutionId: result.resolution.id,
        }),
      );
    },
    onError: handleSessionError,
  });

  if (!scopeValid)
    return (
      <ProfileFailure
        title="Invalid Target context"
        message="Return to the active Case and open the Target again."
        context={context}
      />
    );
  if (profile.isPending) return <ProfileLoading />;
  if (profile.error)
    return (
      <ProfileFailure
        title="Target unavailable"
        message={profile.error.message}
        context={context}
      />
    );
  if (
    profile.data.subject.status === "RESOLVING" &&
    !validResolutionId &&
    currentResolution.isPending
  )
    return <ProfileLoading />;
  if (
    profile.data.subject.status === "RESOLVING" &&
    !validResolutionId &&
    currentResolution.error
  )
    return (
      <ProfileFailure
        title="Review session unavailable"
        message={currentResolution.error.message}
        context={context}
      />
    );

  const value = profile.data;
  const mutable = !["CLOSED", "ARCHIVED"].includes(context.case.status);
  const canResolve = context.access.permissions.update && mutable;
  const knownFields = seed.data?.fields ?? [];

  return (
    <section className="target-profile" aria-label="SHADOW Target Profile">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href={productHref("SHADOW", { workspaceId: context.workspace.id, caseId })}>
          {context.case.code}
        </Link>
        <span>/</span>
        <span>Target Profile</span>
      </nav>
      <header className="target-hero">
        <div className="target-avatar" aria-hidden="true">
          {(value.identitySummary.displayLabel ?? value.identitySummary.type).slice(0, 1)}
        </div>
        <div>
          <p className="eyebrow">
            {humanize(value.identitySummary.type)} / {humanize(value.subject.role)}
          </p>
          <h1>{value.identitySummary.displayLabel ?? "Unresolved Target"}</h1>
          <div className="badges">
            <span className={`status-pill status-${value.subject.status.toLowerCase()}`}>
              {humanize(value.subject.status)}
            </span>
            <span className="badge">REV {value.subject.revision}</span>
          </div>
        </div>
        <div className="hero-actions">
          {canResolve &&
            ["UNRESOLVED", "RESOLUTION_FAILED"].includes(value.subject.status) && (
              <button
                className="primary"
                disabled={start.isPending}
                onClick={() => start.mutate()}
              >
                {start.isPending ? "Starting…" : "Start resolution"}
              </button>
            )}
        </div>
      </header>
      <ErrorNotice error={start.error} />
      <div className="stage-tabs" role="tablist" aria-label="Target views">
        <button role="tab" aria-selected="true">
          Overview
        </button>
        <button role="tab" disabled>
          Canvas · later
        </button>
        <button role="tab" disabled>
          Timeline · later
        </button>
        <button role="tab" disabled>
          Map · later
        </button>
      </div>
      <div className="profile-grid">
        <section className="profile-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">IDENTITY SUMMARY</p>
              <h2>Known information</h2>
            </div>
          </div>
          {seed.isPending ? (
            <p role="status">Loading protected fields…</p>
          ) : seed.error ? (
            <ErrorNotice error={seed.error} />
          ) : knownFields.length ? (
            <dl className="identity-fields">
              {knownFields.map((field) => (
                <div key={field.id}>
                  <dt>{humanize(field.name)}</dt>
                  <dd>{presentField(field.value)}</dd>
                  <small>
                    {field.classification} · {field.value.visibility}
                  </small>
                </div>
              ))}
            </dl>
          ) : (
            <p className="scope-note">No seed fields are available.</p>
          )}
          {value.identitySummary.identifiers.length > 0 && (
            <>
              <h3>Protected identifiers</h3>
              <dl className="identity-fields">
                {value.identitySummary.identifiers.map((identifier) => (
                  <div key={identifier.id}>
                    <dt>{humanize(identifier.type)}</dt>
                    <dd>{presentField(identifier)}</dd>
                    <small>
                      {identifier.classification} · {identifier.visibility}
                    </small>
                  </div>
                ))}
              </dl>
            </>
          )}
          {value.identitySummary.aliases.length > 0 && (
            <p className="scope-note">
              Aliases:{" "}
              {value.identitySummary.aliases.map((alias) => alias.label).join(", ")}
            </p>
          )}
        </section>
        <section className="profile-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">PROFILE STATE</p>
              <h2>Canonical status</h2>
            </div>
          </div>
          <dl className="profile-state">
            <div>
              <dt>Subject</dt>
              <dd>{humanize(value.subject.status)}</dd>
            </div>
            <div>
              <dt>Entity</dt>
              <dd>{value.entity ? "Linked" : "Not linked"}</dd>
            </div>
            <div>
              <dt>Generated</dt>
              <dd>{formatInstant(value.freshness.generatedAt)}</dd>
            </div>
            <div>
              <dt>Source revision</dt>
              <dd>{value.freshness.entityRevision ?? value.freshness.subjectRevision}</dd>
            </div>
          </dl>
        </section>
      </div>
      <ResolutionReview
        resolutionId={validResolutionId}
        resolution={resolution}
        candidates={candidates}
        matches={matches}
        canResolve={canResolve}
        caseId={caseId}
        subjectId={subjectId}
      />
      <section className="capability-strip" aria-label="Upcoming Target capabilities">
        <span>Workspace knowledge · not implemented</span>
        <span>Source coverage · not implemented</span>
        <span>Evidence · not implemented</span>
      </section>
    </section>
  );
}

function ResolutionReview(props: {
  resolutionId: string | null;
  resolution: ReturnType<typeof useQuery>;
  candidates: ReturnType<typeof useQuery>;
  matches: ReturnType<typeof useQuery>;
  canResolve: boolean;
  caseId: string;
  subjectId: string;
}) {
  if (!props.resolutionId)
    return (
      <section className="review-board">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RESOLUTION</p>
            <h2>Candidate review</h2>
          </div>
        </div>
        <div className="compact-empty">
          <h3>No review session opened</h3>
          <p>Start resolution to let trusted lookup services attach review candidates.</p>
        </div>
      </section>
    );
  if (props.resolution.isPending || props.candidates.isPending || props.matches.isPending)
    return (
      <section className="review-board">
        <p role="status">Loading candidate review…</p>
      </section>
    );
  const error = props.resolution.error ?? props.candidates.error ?? props.matches.error;
  if (error instanceof Error)
    return (
      <section className="review-board">
        <ErrorNotice error={error} />
      </section>
    );
  const session = props.resolution.data as Awaited<ReturnType<typeof api.resolution>>;
  const candidatePage = props.candidates.data as Awaited<
    ReturnType<typeof api.candidates>
  >;
  const matchPage = props.matches.data as Awaited<ReturnType<typeof api.matches>>;
  return (
    <section className="review-board">
      <div className="section-heading">
        <div>
          <p className="eyebrow">RESOLUTION / {humanize(session.status)}</p>
          <h2>Candidate review</h2>
        </div>
        <span>
          {session.candidatesCount} candidate{session.candidatesCount === 1 ? "" : "s"}
        </span>
      </div>
      {candidatePage.items.length ? (
        <div className="candidate-stack">
          {candidatePage.items.map((candidate) => (
            <CandidateCard
              key={candidate.id}
              candidate={candidate}
              matches={matchPage.items.filter(
                (match) => match.candidateId === candidate.id,
              )}
              enabled={props.canResolve && candidate.status === "PENDING_REVIEW"}
              caseId={props.caseId}
              subjectId={props.subjectId}
              resolutionId={props.resolutionId!}
            />
          ))}
        </div>
      ) : (
        <div className="compact-empty">
          <h3>Awaiting candidates</h3>
          <p>
            The session is active. Candidate producers will populate this review queue; no
            synthetic response is shown.
          </p>
        </div>
      )}
    </section>
  );
}

function CandidateCard(props: {
  candidate: Candidate;
  matches: EntityMatchView[];
  enabled: boolean;
  caseId: string;
  subjectId: string;
  resolutionId: string;
}) {
  const client = useQueryClient();
  const [reason, setReason] = useState<ResolutionReasonCode>("MANUAL_REVIEW");
  const decide = useMutation({
    mutationFn: (input: {
      decision: "LINK_EXISTING" | "CREATE_NEW" | "UNCERTAIN" | "REJECT";
      entityId?: string;
    }) =>
      api.resolveCandidate(
        props.candidate.id,
        { ...input, reasonCode: reason },
        props.candidate.revision,
        crypto.randomUUID(),
        crypto.randomUUID(),
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({
          queryKey: ["target-profile", props.caseId, props.subjectId],
        }),
        client.invalidateQueries({ queryKey: ["resolution", props.resolutionId] }),
        client.invalidateQueries({ queryKey: ["candidates", props.resolutionId] }),
        client.invalidateQueries({ queryKey: ["matches", props.resolutionId] }),
        client.invalidateQueries({ queryKey: ["subjects", props.caseId] }),
      ]);
    },
    onError: handleSessionError,
  });
  return (
    <article className="candidate-card">
      <div className="candidate-title">
        <div>
          <strong>{props.candidate.displayLabel}</strong>
          <p>
            {humanize(props.candidate.type)} · {props.candidate.classification}
          </p>
        </div>
        <span className={`status-pill status-${props.candidate.status.toLowerCase()}`}>
          {humanize(props.candidate.status)}
        </span>
      </div>
      {props.matches.length ? (
        props.matches.map((match) => (
          <div className="match-panel" key={match.id}>
            <div>
              <strong>{humanize(match.matchLevel)} match</strong>
              <small>Existing Entity · {shortId(match.entityRef.id)}</small>
            </div>
            <SignalList title="Supporting" items={match.signals} />
            <SignalList title="Conflicts" items={match.conflicts} />
            {props.enabled && (
              <button
                onClick={() =>
                  decide.mutate({
                    decision: "LINK_EXISTING",
                    entityId: match.entityRef.id,
                  })
                }
              >
                Link existing
              </button>
            )}
          </div>
        ))
      ) : (
        <p className="scope-note">No policy-visible existing Entity match.</p>
      )}
      {props.enabled && (
        <div className="decision-bar">
          <label>
            Reason
            <select
              value={reason}
              onChange={(event) => setReason(event.target.value as ResolutionReasonCode)}
            >
              {RESOLUTION_REASON_CODES.map((code) => (
                <option value={code} key={code}>
                  {humanize(code)}
                </option>
              ))}
            </select>
          </label>
          {props.candidate.classification !== "RESTRICTED" && (
            <button
              className="primary"
              onClick={() => decide.mutate({ decision: "CREATE_NEW" })}
            >
              Create new Entity
            </button>
          )}
          <button onClick={() => decide.mutate({ decision: "UNCERTAIN" })}>
            Mark uncertain
          </button>
          <button
            className="danger"
            onClick={() => decide.mutate({ decision: "REJECT" })}
          >
            Reject
          </button>
        </div>
      )}
      <ErrorNotice error={decide.error} />
    </article>
  );
}

function SignalList({
  title,
  items,
}: {
  title: string;
  items: EntityMatchView["signals"];
}) {
  if (!items.length) return null;
  return (
    <div className="signal-list">
      <span>{title}</span>
      {items.map((item, index) => (
        <small key={`${item.field}:${index}`}>
          {humanize(item.field)} · {humanize(item.result)} · {item.valueVisibility}
        </small>
      ))}
    </div>
  );
}
function presentField(value: {
  visibility: string;
  displayValue?: string;
  matchStatus?: string;
}) {
  if (value.visibility === "HIDDEN") return "Hidden by policy";
  if (value.visibility === "MATCH_ONLY") return humanize(value.matchStatus ?? "UNKNOWN");
  return value.displayValue ?? "Unavailable";
}
function shortId(value: string) {
  return `${value.slice(0, 8)}…`;
}
function formatInstant(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function ProfileLoading() {
  return (
    <section className="empty-state" role="status">
      <span className="loading-mark" />
      <p>Loading Target Profile…</p>
    </section>
  );
}
function ProfileFailure({
  title,
  message,
  context,
}: {
  title: string;
  message: string;
  context: ReturnType<typeof useCaseContext>;
}) {
  return (
    <section className="empty-state" role="alert">
      <p className="eyebrow">TARGET ACCESS</p>
      <h1>{title}</h1>
      <p>{message}</p>
      <Link
        className="button"
        href={productHref("SHADOW", {
          workspaceId: context.workspace.id,
          caseId: context.case.id,
        })}
      >
        Back to Case
      </Link>
    </section>
  );
}
function handleSessionError(error: Error) {
  if (error instanceof ApiError && error.status === 401)
    window.dispatchEvent(new Event("platform-session-expired"));
}
