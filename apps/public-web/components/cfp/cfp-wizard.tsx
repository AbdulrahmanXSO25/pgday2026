"use client";

import { useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus, Trash2 } from "lucide-react";
import { CfpSubmissionSchema, type CfpSubmissionInput } from "@pgegypt/validation";
import { cn } from "@/lib/utils";

/**
 * CFP submission wizard (§19.1) — public, unauthenticated, multi-step.
 * Step 1: talk details · Step 2: speakers (primary + up to 3 co-speakers) · Step 3: review & submit.
 * Posts directly to the API Worker (NEXT_PUBLIC_API_BASE_URL) with the spec payload shape.
 */

type SpeakerDraft = {
  fullName: string;
  email: string;
  bio: string;
  company: string;
  role: string;
  isPrimary: boolean;
};

type WizardState = {
  title: string;
  abstract: string;
  sessionType: "talk" | "panel";
  level: "beginner" | "intermediate" | "advanced" | "";
  notesToOrganizers: string;
  speakers: SpeakerDraft[];
};

const STEPS = ["Talk details", "Speakers", "Review & submit"] as const;

const inputStyles =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted/60 transition-colors focus:border-pg-blue focus:outline-none focus:ring-1 focus:ring-pg-blue/40";

function Field({
  label,
  required,
  error,
  id,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="text-pg-amber">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error && (
        <p role="alert" className="mono-data text-pg-amber mt-1.5 text-[11px]">
          ✗ {error}
        </p>
      )}
    </div>
  );
}

export function CfpWizard() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<WizardState>({
    title: "",
    abstract: "",
    sessionType: "talk",
    level: "",
    notesToOrganizers: "",
    speakers: [{ fullName: "", email: "", bio: "", company: "", role: "", isPrimary: true }],
  });
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedId, setSubmittedId] = useState<string | null>(null);

  const set = <K extends keyof WizardState>(key: K, value: WizardState[K]) => {
    setState((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[key as string];
      return next;
    });
  };

  const setSpeaker = (index: number, patch: Partial<SpeakerDraft>) => {
    setState((prev) => ({
      ...prev,
      speakers: prev.speakers.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  };

  const addSpeaker = () => {
    if (state.speakers.length >= 4) return;
    setState((prev) => ({
      ...prev,
      speakers: [
        ...prev.speakers,
        { fullName: "", email: "", bio: "", company: "", role: "", isPrimary: false },
      ],
    }));
  };

  const removeSpeaker = (index: number) => {
    if (state.speakers.length <= 1) return;
    setState((prev) => ({ ...prev, speakers: prev.speakers.filter((_, i) => i !== index) }));
  };

  const buildPayload = (): CfpSubmissionInput => ({
    title: state.title,
    abstract: state.abstract,
    sessionType: state.sessionType,
    level: state.level || undefined,
    notesToOrganizers: state.notesToOrganizers || undefined,
    speakers: state.speakers.map((s) => ({
      fullName: s.fullName,
      email: s.email,
      bio: s.bio || undefined,
      company: s.company || undefined,
      role: s.role || undefined,
      isPrimary: s.isPrimary,
    })),
  });

  const validateStep = (): boolean => {
    const next: Record<string, string> = {};
    if (step === 0) {
      if (state.title.trim().length < 5) next.title = "Title must be at least 5 characters.";
      if (state.abstract.trim().length < 20)
        next.abstract = "Abstract must be at least 20 characters.";
    }
    if (step === 1) {
      state.speakers.forEach((s, i) => {
        const prefix = `speakers.${i}.`;
        if (s.fullName.trim().length < 2) next[`${prefix}fullName`] = "Full name is required.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.email.trim()))
          next[`${prefix}email`] = "Enter a valid email.";
      });
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const next = () => {
    if (!validateStep()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
    setSubmitError(null);
  };

  const back = () => setStep((s) => Math.max(s - 1, 0));

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8787";
      const res = await fetch(`${apiBase}/v1/cfp/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...buildPayload(), website: honeypot }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        data?: { id?: string };
        message?: string;
        fieldErrors?: Record<string, string[]>;
      };
      if (res.ok && data.success) {
        setSubmittedId(data.data?.id ?? null);
        return;
      }
      if (res.status === 429) {
        setSubmitError(data.message ?? "Too many attempts. Please try again in a little while.");
      } else if (data.fieldErrors) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(data.fieldErrors))
          flat[k] = Array.isArray(v) ? v[0] : String(v);
        setErrors(flat);
        setStep(0);
        setSubmitError("Some fields need attention — please review the highlighted errors.");
      } else {
        setSubmitError(data.message ?? "Something went wrong. Please try again in a moment.");
      }
    } catch {
      setSubmitError("Network error — please check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submittedId) {
    return (
      <div role="status" className="card mx-auto max-w-xl p-8 text-center sm:p-10">
        <CheckCircle2 aria-hidden="true" className="text-pg-blue mx-auto size-12" />
        <h2 className="font-display mt-5 text-2xl font-bold">Submission received!</h2>
        <p className="text-ink-muted mt-3 leading-relaxed">
          Thanks for proposing a talk for PG Day Egypt 2026. Our program committee will review it
          and get back to you at the email you provided.
        </p>
        <p className="mono-data text-ink-muted mt-6">
          reference <span className="text-pg-blue">{submittedId.slice(0, 8)}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      {/* Stepper */}
      <ol className="mb-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold",
                i < step
                  ? "border-pg-blue bg-pg-blue text-white"
                  : i === step
                    ? "border-pg-blue text-pg-blue"
                    : "border-hairline text-ink-muted"
              )}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                "hidden text-xs font-medium sm:block",
                i === step ? "text-ink" : "text-ink-muted"
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="border-hairline h-px flex-1 border-t" />}
          </li>
        ))}
      </ol>

      {submitError && (
        <div
          role="alert"
          className="border-pg-amber bg-pg-amber/10 text-pg-amber mb-6 rounded-sm border px-3 py-2.5 text-sm"
        >
          {submitError}
        </div>
      )}

      {/* Honeypot (§30.4) */}
      <div
        className="absolute top-auto left-[-9999px] h-px w-px overflow-hidden"
        aria-hidden="true"
      >
        <label htmlFor="cfp-website">Website</label>
        <input
          id="cfp-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={honeypot}
          onChange={(e) => setHoneypot(e.target.value)}
        />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (step < STEPS.length - 1) next();
          else void submit();
        }}
        noValidate
      >
        {step === 0 && (
          <div className="card space-y-5 p-6 sm:p-8">
            <Field label="Talk title" required error={errors.title} id="cfp-title">
              <input
                id="cfp-title"
                className={inputStyles}
                value={state.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Logical replication at scale"
                aria-invalid={Boolean(errors.title)}
              />
            </Field>
            <Field label="Abstract" required error={errors.abstract} id="cfp-abstract">
              <textarea
                id="cfp-abstract"
                className={cn(inputStyles, "resize-y")}
                rows={6}
                value={state.abstract}
                onChange={(e) => set("abstract", e.target.value)}
                placeholder="What will attendees learn? Keep it under 5000 characters."
                aria-invalid={Boolean(errors.abstract)}
              />
            </Field>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Session type" required id="cfp-session-type">
                <select
                  id="cfp-session-type"
                  className={inputStyles}
                  value={state.sessionType}
                  onChange={(e) => set("sessionType", e.target.value as "talk" | "panel")}
                >
                  <option value="talk">Talk (30–45 min)</option>
                  <option value="panel">Panel</option>
                </select>
              </Field>
              <Field label="Level" id="cfp-level">
                <select
                  id="cfp-level"
                  className={inputStyles}
                  value={state.level}
                  onChange={(e) => set("level", e.target.value as WizardState["level"])}
                >
                  <option value="">Any level</option>
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </Field>
            </div>
            <Field label="Notes to organizers (optional)" id="cfp-notes">
              <textarea
                id="cfp-notes"
                className={cn(inputStyles, "resize-y")}
                rows={3}
                value={state.notesToOrganizers}
                onChange={(e) => set("notesToOrganizers", e.target.value)}
                placeholder="Scheduling constraints, AV needs, anything else…"
              />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-5">
            {state.speakers.map((s, i) => (
              <div key={i} className="card space-y-4 p-6 sm:p-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    {s.isPrimary ? "Primary speaker" : `Co-speaker ${i}`}
                    {s.isPrimary && (
                      <span className="mono-data text-pg-blue ml-2 text-[11px]">primary</span>
                    )}
                  </h3>
                  {!s.isPrimary && (
                    <button
                      type="button"
                      onClick={() => removeSpeaker(i)}
                      aria-label={`Remove co-speaker ${i}`}
                      className="text-pg-amber hover:underline"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Full name"
                    required
                    error={errors[`speakers.${i}.fullName`]}
                    id={`cfp-speaker-${i}-name`}
                  >
                    <input
                      id={`cfp-speaker-${i}-name`}
                      className={inputStyles}
                      value={s.fullName}
                      onChange={(e) => setSpeaker(i, { fullName: e.target.value })}
                    />
                  </Field>
                  <Field
                    label="Email"
                    required
                    error={errors[`speakers.${i}.email`]}
                    id={`cfp-speaker-${i}-email`}
                  >
                    <input
                      id={`cfp-speaker-${i}-email`}
                      className={inputStyles}
                      type="email"
                      value={s.email}
                      onChange={(e) => setSpeaker(i, { email: e.target.value })}
                    />
                  </Field>
                  <Field label="Company (optional)" id={`cfp-speaker-${i}-company`}>
                    <input
                      id={`cfp-speaker-${i}-company`}
                      className={inputStyles}
                      value={s.company}
                      onChange={(e) => setSpeaker(i, { company: e.target.value })}
                    />
                  </Field>
                  <Field label="Role (optional)" id={`cfp-speaker-${i}-role`}>
                    <input
                      id={`cfp-speaker-${i}-role`}
                      className={inputStyles}
                      value={s.role}
                      onChange={(e) => setSpeaker(i, { role: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="Short bio (optional)" id={`cfp-speaker-${i}-bio`}>
                  <textarea
                    id={`cfp-speaker-${i}-bio`}
                    className={cn(inputStyles, "resize-y")}
                    rows={3}
                    value={s.bio}
                    onChange={(e) => setSpeaker(i, { bio: e.target.value })}
                  />
                </Field>
              </div>
            ))}
            {state.speakers.length < 4 && (
              <button
                type="button"
                onClick={addSpeaker}
                className="border-hairline bg-surface text-pg-blue hover:border-pg-blue inline-flex items-center gap-2 rounded-sm border px-4 py-2 text-sm font-medium"
              >
                <Plus className="size-4" /> Add co-speaker
              </button>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="card space-y-4 p-6 sm:p-8">
            <h3 className="text-lg font-bold">{state.title}</h3>
            <p className="mono-data text-ink-muted text-xs uppercase">
              {state.sessionType} · {state.level || "any level"}
            </p>
            <p className="text-ink-muted text-sm leading-relaxed whitespace-pre-wrap">
              {state.abstract}
            </p>
            <div className="border-hairline border-t pt-4">
              <p className="mono-data text-ink-muted text-xs uppercase">Speakers</p>
              <ul className="mt-2 space-y-1">
                {state.speakers.map((s, i) => (
                  <li key={i} className="text-sm">
                    <span className="font-semibold">{s.fullName}</span>
                    <span className="text-ink-muted"> · {s.email}</span>
                    {s.isPrimary && (
                      <span className="mono-data text-pg-blue ml-2 text-[11px]">primary</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {state.notesToOrganizers && (
              <p className="mono-data text-ink-muted border-hairline border-t pt-3 text-xs">
                Notes: {state.notesToOrganizers}
              </p>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 0}
            className="border-hairline bg-surface text-ink inline-flex items-center gap-1 rounded-sm border px-4 py-2 text-sm font-medium disabled:opacity-40"
          >
            <ChevronLeft className="size-4" /> Back
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="bg-pg-blue border-pg-blue hover:bg-pg-blue-dark inline-flex items-center gap-1 rounded-sm border px-6 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Submitting…
              </>
            ) : step < STEPS.length - 1 ? (
              <>
                Continue <ChevronRight className="size-4" />
              </>
            ) : (
              "Submit proposal"
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
