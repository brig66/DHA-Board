"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fullName } from "@/lib/format";

export type PickerContact = {
  id: string;
  first_name: string;
  last_name: string;
  organization: string | null;
  email: string | null;
  phone: string | null;
  is_anonymous?: boolean;
};

/** Choose an existing person by name, business or email, or add a new one. */
export default function ContactPicker({
  label,
  contacts,
  value,
  onChange,
  onCreated,
}: {
  label: string;
  contacts: PickerContact[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreated: (c: PickerContact) => void;
}) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ first_name: "", last_name: "", organization: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = contacts.find((c) => c.id === value) ?? null;
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts
      .filter((c) => !c.is_anonymous)
      .filter((c) => [c.first_name, c.last_name, c.organization, c.email].join(" ").toLowerCase().includes(q))
      .slice(0, 8);
  }, [contacts, query]);

  async function create() {
    const first = draft.first_name.trim();
    const last = draft.last_name.trim();
    const org = draft.organization.trim();
    const email = draft.email.trim().toLowerCase();
    if (!first && !last && !org) return setError("Enter a name or a business name.");
    if (email) {
      const existing = contacts.find((c) => c.email?.toLowerCase() === email);
      if (existing && !confirm(`${fullName(existing)} already uses ${email}. Add a separate person anyway?`)) {
        onChange(existing.id);
        setAdding(false);
        return;
      }
    }
    setBusy(true);
    setError(null);
    const row = {
      first_name: first,
      last_name: last || (!first && org ? org : ""),
      organization: org || null,
      email: email || null,
      phone: draft.phone.trim() || null,
    };
    const { data, error } = await createClient().from("contacts").insert(row).select("id, first_name, last_name, organization, email, phone").single();
    setBusy(false);
    if (error) return setError(error.message);
    onCreated(data as PickerContact);
    onChange((data as PickerContact).id);
    setAdding(false);
    setDraft({ first_name: "", last_name: "", organization: "", email: "", phone: "" });
  }

  if (selected)
    return (
      <div>
        <span className="label">{label}</span>
        <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-white px-3 py-2 text-sm">
          <span className="font-semibold">{fullName(selected)}</span>
          {selected.organization && selected.organization !== selected.last_name && <span className="muted">{selected.organization}</span>}
          {selected.email && <span className="muted">{selected.email}</span>}
          <button type="button" className="ml-auto text-xs font-semibold text-coral-600" onClick={() => onChange(null)}>Change</button>
        </div>
      </div>
    );

  return (
    <div className="relative">
      <span className="label">{label}</span>
      {!adding ? (
        <>
          <input
            className="input mt-1"
            placeholder="Type a name, business or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-white shadow-lg">
              {matches.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-[#faf8f3]"
                  onClick={() => { onChange(c.id); setQuery(""); }}
                >
                  <span className="font-semibold">{fullName(c)}</span>
                  {c.organization && c.organization !== c.last_name && <span className="muted"> · {c.organization}</span>}
                  {c.email && <span className="muted"> · {c.email}</span>}
                </button>
              ))}
              {matches.length === 0 && <p className="muted px-3 py-2 text-sm">No one in the CRM matches.</p>}
              <button
                type="button"
                className="block w-full border-t border-[var(--border)] px-3 py-2 text-left text-sm font-semibold text-teal-700 hover:bg-[#faf8f3]"
                onClick={() => {
                  const parts = query.trim().split(/\s+/);
                  setDraft({ ...draft, first_name: parts.length > 1 ? parts[0] : "", last_name: parts.length > 1 ? parts.slice(1).join(" ") : parts[0] ?? "" });
                  setAdding(true);
                }}
              >
                + Add a new person
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="mt-1 grid gap-2 rounded-lg border border-[var(--border)] bg-white p-3 md:grid-cols-2">
          <input className="input" placeholder="First name" value={draft.first_name} onChange={(e) => setDraft({ ...draft, first_name: e.target.value })} />
          <input className="input" placeholder="Last name" value={draft.last_name} onChange={(e) => setDraft({ ...draft, last_name: e.target.value })} />
          <input className="input md:col-span-2" placeholder="Business (optional)" value={draft.organization} onChange={(e) => setDraft({ ...draft, organization: e.target.value })} />
          <input className="input" type="email" placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
          <input className="input" type="tel" placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
          <div className="flex flex-wrap items-center gap-2 md:col-span-2">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={create}>{busy ? "Adding…" : "Add person"}</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(false)}>Cancel</button>
            {error && <span className="text-sm text-coral-600">{error}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
