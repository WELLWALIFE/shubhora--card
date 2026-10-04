"use client";

import { startTransition, useActionState, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import type { FormState } from "@/app/actions/auth";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

/** A form bound to a server action, showing its error or success message and a pending state. */
export function ActionForm({ action, children, submit, className, danger }: {
  action: Action; children: React.ReactNode; submit: string; className?: string; danger?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  // React clears every field after a form action. Submit by hand instead, so a mistake keeps what the
  // person typed; clear the form only after a success.
  useEffect(() => { if (state?.ok) ref.current?.reset(); }, [state]);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  };
  return (
    <form ref={ref} action={formAction} onSubmit={onSubmit} className={className ?? "space-y-4"}>
      {children}
      {state?.error && <p role="alert" className="rounded-lg bg-red-soft px-3 py-2 text-sm font-medium text-red">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-lg bg-green-soft px-3 py-2 text-sm font-medium text-green">{state.ok}</p>}
      {state?.secret && <p className="rounded-lg border-2 border-dashed border-brand bg-brand-soft px-3 py-2 text-center font-mono text-lg font-bold tracking-wider text-brand-ink select-all">{state.secret}</p>}
      {state?.link && <a href={state.link.href} target="_blank" rel="noreferrer" className="btn w-full bg-[#25D366] text-white">{state.link.label}</a>}
      <button disabled={pending} className={`btn ${danger ? "btn-danger" : "btn-primary"} w-full`}>
        {pending && <Loader2 className="h-4 w-4 animate-spin" />}{submit}
      </button>
    </form>
  );
}

export function Field({ label, name, type = "text", defaultValue, placeholder, required, autoComplete, hint, inputMode }: {
  label: string; name: string; type?: string; defaultValue?: string; placeholder?: string; required?: boolean;
  autoComplete?: string; hint?: string; inputMode?: "numeric" | "tel" | "email" | "text";
}) {
  const [show, setShow] = useState(false);
  const isPw = type === "password";
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <div className="relative">
        <input id={name} name={name} type={isPw && show ? "text" : type} defaultValue={defaultValue} placeholder={placeholder}
          required={required} autoComplete={autoComplete} inputMode={inputMode} className={`input ${isPw ? "pr-10" : ""}`} />
        {isPw && (
          <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint hover:text-ink">
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
