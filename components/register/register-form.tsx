"use client";

import { useState } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { RegistrationSchema, type RegistrationInput } from "@/lib/schema";
import { cn } from "@/lib/utils";

type FormErrors = Partial<Record<keyof RegistrationInput, string>>;

type FormValues = Omit<RegistrationInput, "consent"> & { consent: boolean };

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string; fieldErrors?: FormErrors };

const fieldConfig: {
  name: keyof FormValues;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  textarea?: boolean;
}[] = [
  { name: "name", label: "Full name", placeholder: "e.g. Sara Abdelrahman", required: true },
  { name: "email", label: "Email", type: "email", placeholder: "you@example.com", required: true },
  { name: "organization", label: "Organization (optional)", placeholder: "e.g. Instabug" },
  { name: "role", label: "Role / job title (optional)", placeholder: "e.g. Backend Engineer" },
  {
    name: "dietaryNotes",
    label: "Dietary notes (optional)",
    placeholder: "Anything we should know for catering, e.g. vegetarian, allergies…",
    textarea: true,
  },
];

const inputStyles =
  "w-full rounded-sm border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted/60 transition-colors focus:border-pg-blue focus:outline-none focus:ring-1 focus:ring-pg-blue/40";

export function RegisterForm() {
  const [values, setValues] = useState<FormValues>({
    name: "",
    email: "",
    organization: "",
    role: "",
    dietaryNotes: "",
    consent: false,
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitState, setSubmitState] = useState<SubmitState>({ status: "idle" });

  const submitting = submitState.status === "submitting";

  const setValue = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => ({ ...prev, [key]: undefined }));
  };

  const validate = (input: FormValues): FormErrors => {
    const result = RegistrationSchema.safeParse(input);
    if (result.success) return {};
    const next: FormErrors = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof RegistrationInput;
      if (!next[key]) next[key] = issue.message;
    }
    return next;
  };

  const handleBlur = (key: keyof FormValues) => {
    if (key === "name" || key === "email" || key === "consent") {
      const next = validate(values);
      setErrors((prev) => ({ ...prev, [key]: next[key] }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const next = validate(values);
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setSubmitState({ status: "submitting" });
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        fieldErrors?: FormErrors;
      };

      if (res.ok && data.success) {
        setSubmitState({ status: "success" });
      } else if (res.status === 409) {
        setSubmitState({
          status: "error",
          message: data.message ?? "Looks like this email is already registered.",
        });
      } else if (data.fieldErrors) {
        setErrors(data.fieldErrors);
        setSubmitState({ status: "idle" });
      } else {
        setSubmitState({
          status: "error",
          message:
            data.message ?? "Something went wrong while submitting. Please try again in a moment.",
        });
      }
    } catch {
      setSubmitState({
        status: "error",
        message: "Network error — please check your connection and try again.",
      });
    }
  };

  if (submitState.status === "success") {
    return (
      <div role="status" className="card mx-auto max-w-xl p-8 text-center sm:p-10">
        <CheckCircle2 aria-hidden="true" className="text-pg-blue mx-auto size-12" />
        <h2 className="font-display mt-5 text-2xl font-bold">You&apos;re registered!</h2>
        <p className="text-ink-muted mt-3 leading-relaxed">
          Check your email for a confirmation from us. We&apos;ll follow up closer to the event with
          final attendance details.
        </p>
        <p className="mono-data text-ink-muted mt-6">
          INSERT INTO attendees … <span className="text-pg-blue">1 row inserted</span>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-xl">
      {submitState.status === "error" && (
        <div
          role="alert"
          className="border-pg-amber bg-pg-amber/10 text-pg-amber mb-6 rounded-sm border px-3 py-2.5 text-sm"
        >
          {submitState.message}
        </div>
      )}

      <div className="space-y-5">
        {fieldConfig.map((field) => (
          <div key={field.name}>
            <label
              htmlFor={`field-${field.name}`}
              className="text-ink mb-1.5 block text-sm font-medium"
            >
              {field.label}
            </label>
            {field.textarea ? (
              <textarea
                id={`field-${field.name}`}
                name={field.name}
                rows={3}
                placeholder={field.placeholder}
                value={values[field.name] as string}
                onChange={(e) => setValue(field.name, e.target.value)}
                onBlur={() => handleBlur(field.name)}
                disabled={submitting}
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={errors[field.name] ? `error-${field.name}` : undefined}
                className={cn(inputStyles, "resize-y", errors[field.name] && "border-pg-amber/60")}
              />
            ) : (
              <input
                id={`field-${field.name}`}
                name={field.name}
                type={field.type ?? "text"}
                placeholder={field.placeholder}
                value={values[field.name] as string}
                onChange={(e) => setValue(field.name, e.target.value)}
                onBlur={() => handleBlur(field.name)}
                disabled={submitting}
                aria-invalid={Boolean(errors[field.name])}
                aria-describedby={errors[field.name] ? `error-${field.name}` : undefined}
                className={cn(inputStyles, errors[field.name] && "border-pg-amber/60")}
              />
            )}
            {errors[field.name] && (
              <p id={`error-${field.name}`} className="mono-data text-pg-amber mt-1.5 text-[11px]">
                ✗ {errors[field.name]}
              </p>
            )}
          </div>
        ))}

        <div>
          <label className="text-ink-muted flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              name="consent"
              checked={values.consent}
              onChange={(e) => setValue("consent", e.target.checked)}
              onBlur={() => handleBlur("consent")}
              disabled={submitting}
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={errors.consent ? "error-consent" : undefined}
              className="mt-0.5 size-4 shrink-0 accent-[#336791]"
            />
            <span>
              I agree to be contacted about PG Day Egypt 2026
              <span aria-hidden="true" className="text-pg-amber">
                {" "}
                *
              </span>
            </span>
          </label>
          {errors.consent && (
            <p id="error-consent" className="mono-data text-pg-amber mt-1.5 text-[11px]">
              ✗ {errors.consent}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="bg-pg-blue border-pg-blue hover:bg-pg-blue-dark w-full rounded-sm border px-6 py-3 text-sm font-semibold text-white transition-colors disabled:pointer-events-none disabled:opacity-60"
        >
          {submitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Registering…
            </span>
          ) : (
            "Register to Attend"
          )}
        </button>
      </div>
    </form>
  );
}
