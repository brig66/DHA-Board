"use client";

import { useState } from "react";
import { MAX_COPIES, checkCopies, type Copies } from "@/lib/recipients";

/**
 * "Copy someone": more To recipients, Cc and Bcc on every email in a send.
 * `emails` is how many emails the send makes (one per donor), so staff can see
 * how many copies each person will get.
 */
export default function ExtraRecipients({
  value,
  onChange,
  emails,
}: {
  value: Copies;
  onChange: (v: Copies) => void;
  emails: number;
}) {
  const checked = checkCopies(value);
  const [open, setOpen] = useState(checked.any || checked.bad.length > 0);

  if (!open)
    return (
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>
          + Copy someone (To, Cc or Bcc)
        </button>
      </div>
    );

  const field = (key: keyof Copies, label: string, hint: string) => (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <label className="label" htmlFor={`copy-${key}`}>{label}</label>
        <span className="muted text-xs">{hint}</span>
      </div>
      <input
        id={`copy-${key}`}
        className="input mt-1"
        type="text"
        inputMode="email"
        autoComplete="off"
        placeholder="name@example.com"
        value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })}
      />
    </div>
  );

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[#faf8f3] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="label">Copy someone</span>
        {!checked.any && !value.also_to && !value.cc && !value.bcc && (
          <button type="button" className="text-xs font-semibold text-teal-700" onClick={() => setOpen(false)}>
            Hide
          </button>
        )}
      </div>
      <div className="mt-2 grid gap-3">
        {field("also_to", "Also to", "Added next to the donor. Everyone sees each other.")}
        {field("cc", "Cc", "The donor sees who was copied.")}
        {field("bcc", "Bcc", "Hidden from the donor. Each gets a separate copy.")}
      </div>
      <p className="muted mt-2 text-xs">
        Separate several addresses with commas. Tests go only to you.
        {checked.also_to.length + checked.cc.length > 0 && (
          <> Opens aren&rsquo;t tracked on emails with extra To or Cc addresses, since we can&rsquo;t tell who opened them.</>
        )}
      </p>
      {checked.any && emails > 1 && (
        <p className="mt-1 text-sm text-[#b8862e]">
          This send is {emails} separate emails, one per donor, so each address here gets {emails} emails.
        </p>
      )}
      {checked.bad.length > 0 && (
        <p className="mt-1 text-sm text-coral-600">
          Not a complete email address: {checked.bad.join(", ")}
        </p>
      )}
      {checked.total > MAX_COPIES && (
        <p className="mt-1 text-sm text-coral-600">Copy at most {MAX_COPIES} people on one send.</p>
      )}
    </div>
  );
}

/** True when the copies can be sent (no typos, not too many). */
export function copiesOk(v: Copies): boolean {
  const c = checkCopies(v);
  return c.bad.length === 0 && c.total <= MAX_COPIES;
}
