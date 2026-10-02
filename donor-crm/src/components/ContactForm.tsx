"use client";

import { useState } from "react";
import type { Contact } from "@/lib/types";

export type ContactDraft = Pick<
  Contact,
  | "first_name" | "last_name" | "email" | "alt_emails" | "phone" | "alt_phones" | "address"
  | "city" | "state" | "zip" | "country" | "notes" | "do_not_email" | "organization" | "is_board_member"
>;

export const emptyDraft: ContactDraft = {
  first_name: "", last_name: "", email: null, alt_emails: [], phone: null, alt_phones: [],
  address: null, city: null, state: null, zip: null, country: null, notes: null, do_not_email: false,
  organization: null,
  is_board_member: false,
};

const list = (s: string) =>
  s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);

export default function ContactForm({
  initial,
  saving,
  onSave,
  submitLabel,
}: {
  initial: ContactDraft;
  saving: boolean;
  onSave: (d: ContactDraft) => void;
  submitLabel: string;
}) {
  // only the editable fields (the donor page passes a full summary record)
  const [d, setD] = useState<ContactDraft>(() =>
    Object.fromEntries((Object.keys(emptyDraft) as (keyof ContactDraft)[]).map((k) => [k, initial[k] ?? emptyDraft[k]])) as ContactDraft
  );
  const [altEmails, setAltEmails] = useState(initial.alt_emails.join("; "));
  const [altPhones, setAltPhones] = useState(initial.alt_phones.join("; "));

  const set = (k: keyof ContactDraft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setD({ ...d, [k]: e.target.value === "" ? (k === "first_name" || k === "last_name" ? "" : null) : e.target.value });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const organization = d.organization?.trim() || null;
    onSave({
      ...d,
      organization,
      // a business with no contact person is listed under its name
      last_name: !d.first_name && !d.last_name && organization ? organization : d.last_name,
      email: d.email ? d.email.trim().toLowerCase() : null,
      alt_emails: list(altEmails).map((x) => x.toLowerCase()),
      alt_phones: list(altPhones),
    });
  }

  const field = (k: keyof ContactDraft, label: string, opts: { type?: string; span?: string } = {}) => (
    <div className={opts.span ?? ""}>
      <label className="label" htmlFor={k}>{label}</label>
      <input
        id={k}
        type={opts.type ?? "text"}
        className="input mt-1"
        value={(d[k] as string | null) ?? ""}
        onChange={set(k)}
      />
    </div>
  );

  return (
    <form onSubmit={submit} className="grid gap-4 md:grid-cols-6">
      {field("first_name", "First name", { span: "md:col-span-3" })}
      {field("last_name", "Last name", { span: "md:col-span-3" })}
      {field("organization", "Business, practice or foundation (optional)", { span: "md:col-span-6" })}
      {field("email", "Email", { type: "email", span: "md:col-span-3" })}
      <div className="md:col-span-3">
        <label className="label" htmlFor="alt_emails">Other emails (separate with ;)</label>
        <input id="alt_emails" className="input mt-1" value={altEmails} onChange={(e) => setAltEmails(e.target.value)} />
      </div>
      {field("phone", "Phone", { type: "tel", span: "md:col-span-3" })}
      <div className="md:col-span-3">
        <label className="label" htmlFor="alt_phones">Other phones (separate with ;)</label>
        <input id="alt_phones" className="input mt-1" value={altPhones} onChange={(e) => setAltPhones(e.target.value)} />
      </div>
      {field("address", "Mailing address", { span: "md:col-span-6" })}
      {field("city", "City", { span: "md:col-span-3" })}
      {field("state", "State", { span: "md:col-span-1" })}
      {field("zip", "Zip", { span: "md:col-span-2" })}
      <div className="md:col-span-6">
        <label className="label" htmlFor="notes">Notes</label>
        <textarea id="notes" rows={3} className="input mt-1" value={d.notes ?? ""} onChange={set("notes")} />
      </div>
      <label className="flex items-center gap-2 text-sm md:col-span-6">
        <input
          type="checkbox"
          checked={d.do_not_email}
          onChange={(e) => setD({ ...d, do_not_email: e.target.checked })}
        />
        Do not email this donor (they asked to be removed)
      </label>
      <label className="flex items-center gap-2 text-sm md:col-span-6">
        <input
          type="checkbox"
          checked={d.is_board_member}
          onChange={(e) => setD({ ...d, is_board_member: e.target.checked })}
        />
        Current board member (shows on the Board tab)
      </label>
      <div className="md:col-span-6">
        <button className="btn btn-primary" disabled={saving || (!d.first_name && !d.last_name && !d.organization)}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
