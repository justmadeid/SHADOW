"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type CreateSubjectInput,
} from "@intelligence/api-client";
import {
  SUBJECT_ROLES,
  SUBJECT_TYPES,
  shadowTargetHref,
  type DataClassification,
  type SubjectSeedFieldName,
  type SubjectType,
} from "@intelligence/contracts";
import { useCaseContext } from "../../shell/platform-shell";

const api = createApiClient({ baseUrl: "/api/platform" });

export function TargetWorkspace() {
  const context = useCaseContext();
  const router = useRouter();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const keys = useRef(new Map<string, string>());
  const subjects = useQuery({
    queryKey: ["subjects", context.case.id],
    queryFn: async ({ signal }) => {
      const result = await api.subjects(context.case.id, signal);
      if (
        result.items.some(
          (item) =>
            item.caseId !== context.case.id || item.workspaceId !== context.workspace.id,
        )
      )
        throw new ApiError(404);
      return result;
    },
    refetchInterval: 30_000,
  });
  const create = useMutation({
    mutationFn: (input: CreateSubjectInput) => {
      const payload = JSON.stringify(input);
      let key = keys.current.get(payload);
      if (!key) {
        key = crypto.randomUUID();
        keys.current.set(payload, key);
      }
      return api.createSubject(context.case.id, input, key);
    },
    onSuccess: async (subject) => {
      keys.current.clear();
      await client.invalidateQueries({ queryKey: ["subjects", context.case.id] });
      router.push(
        shadowTargetHref({
          workspaceId: context.workspace.id,
          caseId: context.case.id,
          subjectId: subject.id,
        }),
      );
    },
    onError: handleSessionError,
  });
  const mutable = !["CLOSED", "ARCHIVED"].includes(context.case.status);

  return (
    <section className="target-command" aria-label="Case targets">
      <div className="section-heading">
        <div>
          <p className="eyebrow">TARGET REGISTRY</p>
          <h2>Targets</h2>
        </div>
        {context.access.permissions.update && mutable && (
          <button className="primary" onClick={() => setAdding(true)}>
            Add Target
          </button>
        )}
      </div>
      <p className="scope-note">
        Subjects remain Case-scoped until a reviewed candidate is linked to, or creates, a
        canonical Workspace Entity.
      </p>
      {subjects.isPending ? (
        <p role="status">Loading Targets…</p>
      ) : subjects.error ? (
        <ErrorNotice error={subjects.error} />
      ) : subjects.data.items.length ? (
        <div className="target-grid">
          {subjects.data.items.map((subject) => (
            <article className="target-row" key={subject.id}>
              <div className="target-glyph" aria-hidden="true">
                {subject.subjectType.slice(0, 1)}
              </div>
              <div>
                <strong>{labelFor(subject.subjectType)}</strong>
                <p>
                  {humanize(subject.role)} · {subject.seed?.fieldCount ?? 0} known field
                  {subject.seed?.fieldCount === 1 ? "" : "s"}
                </p>
              </div>
              <span className={`status-pill status-${subject.status.toLowerCase()}`}>
                {humanize(subject.status)}
              </span>
              <Link
                className="table-link"
                href={shadowTargetHref({
                  workspaceId: context.workspace.id,
                  caseId: context.case.id,
                  subjectId: subject.id,
                })}
              >
                Open profile
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <div className="compact-empty">
          <h3>No Targets in this Case</h3>
          <p>Add known information to begin a governed resolution workflow.</p>
        </div>
      )}
      {adding && (
        <AddTargetForm
          pending={create.isPending}
          error={create.error}
          onCancel={() => {
            create.reset();
            setAdding(false);
          }}
          onSubmit={(input) => create.mutate(input)}
        />
      )}
    </section>
  );
}

function AddTargetForm(props: {
  pending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (input: CreateSubjectInput) => void;
}) {
  const [type, setType] = useState<SubjectType>("PERSON");
  const [step, setStep] = useState<1 | 2>(1);
  return (
    <div className="target-drawer" role="dialog" aria-labelledby="add-target-title">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const primary = String(data.get("primary")).trim();
          const fields: CreateSubjectInput["seed"]["fields"] = [
            seedField(
              primaryField(type),
              primary,
              String(data.get("classification")) as Exclude<
                DataClassification,
                "RESTRICTED"
              >,
            ),
          ];
          for (const [name, field] of [
            ["username", "USERNAME"],
            ["location", "LOCATION_TEXT"],
            ["profileUrl", "SOCIAL_PROFILE_URL"],
          ] as const) {
            const value = String(data.get(name)).trim();
            if (value && field !== primaryField(type))
              fields.push(
                seedField(
                  field,
                  value,
                  String(data.get("classification")) as Exclude<
                    DataClassification,
                    "RESTRICTED"
                  >,
                ),
              );
          }
          props.onSubmit({
            subjectType: type,
            role: String(data.get("role")) as CreateSubjectInput["role"],
            seed: { fields },
          });
        }}
      >
        <div className="drawer-head">
          <div>
            <p className="eyebrow">ADD TARGET / {step} OF 2</p>
            <h2 id="add-target-title">
              {step === 1 ? "Describe the target" : "Review known information"}
            </h2>
          </div>
          <button type="button" className="quiet" onClick={props.onCancel}>
            Close
          </button>
        </div>
        <div className="step-track" aria-hidden="true">
          <span className="complete" />
          <span className={step === 2 ? "complete" : undefined} />
        </div>
        <div className={step === 2 ? "review-mode" : undefined}>
          <label>
            Target type
            <select
              name="subjectType"
              value={type}
              onChange={(event) => setType(event.target.value as SubjectType)}
            >
              {SUBJECT_TYPES.map((value) => (
                <option value={value} key={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Role in this Case
            <select name="role" defaultValue="PRIMARY_TARGET">
              {SUBJECT_ROLES.map((value) => (
                <option value={value} key={value}>
                  {humanize(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {primaryLabel(type)}
            <input
              name="primary"
              required
              maxLength={300}
              readOnly={step === 2}
              placeholder={primaryPlaceholder(type)}
            />
          </label>
          {type !== "DOMAIN" && (
            <>
              <label>
                Username <small>optional</small>
                <input name="username" maxLength={100} readOnly={step === 2} />
              </label>
              <label>
                Location <small>optional</small>
                <input name="location" maxLength={300} readOnly={step === 2} />
              </label>
              <label>
                Social profile URL <small>optional · HTTPS only</small>
                <input
                  name="profileUrl"
                  type="url"
                  pattern="https://.*"
                  maxLength={2000}
                  readOnly={step === 2}
                />
              </label>
            </>
          )}
          <label>
            Classification
            <select name="classification" defaultValue="INTERNAL">
              <option value="PUBLIC">Public</option>
              <option value="INTERNAL">Internal</option>
              <option value="SENSITIVE">Sensitive · masked after save</option>
            </select>
          </label>
        </div>
        <aside className="guardrail-note">
          NIK, email, and phone are protected identifiers. They are not accepted as
          Subject seed fields; the identifier/lookup flow will handle them without
          exposing raw values in this UI.
        </aside>
        <ErrorNotice error={props.error} />
        <div className="form-actions">
          {step === 2 && (
            <button type="button" onClick={() => setStep(1)}>
              Back
            </button>
          )}
          {step === 1 ? (
            <button type="button" className="primary" onClick={() => setStep(2)}>
              Review
            </button>
          ) : (
            <button className="primary" disabled={props.pending}>
              {props.pending ? "Creating…" : "Create unresolved Target"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}

function seedField(
  name: SubjectSeedFieldName,
  value: string,
  classification: Exclude<DataClassification, "RESTRICTED">,
) {
  return { name, value, classification, origin: "INVESTIGATOR_INPUT" as const };
}
function primaryField(type: SubjectType): SubjectSeedFieldName {
  if (type === "DOMAIN") return "DOMAIN_NAME";
  if (type === "ORGANIZATION") return "ORGANIZATION_NAME";
  return "DISPLAY_NAME";
}
function primaryLabel(type: SubjectType) {
  return type === "DOMAIN"
    ? "Domain name"
    : type === "ORGANIZATION"
      ? "Organization name"
      : "Display name";
}
function primaryPlaceholder(type: SubjectType) {
  return type === "DOMAIN"
    ? "example.org"
    : type === "ORGANIZATION"
      ? "Known organization"
      : "Known name or label";
}
function labelFor(type: SubjectType) {
  return `Unresolved ${humanize(type).toLowerCase()}`;
}
export function humanize(value: string) {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}
export function ErrorNotice({ error }: { error: Error | null }) {
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
