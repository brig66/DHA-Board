"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { shortDate } from "@/lib/format";
import { CHANNEL_LABELS, OPT_OUT_METHODS, type Channel, type ContactSummary, type PreferenceLog } from "@/lib/types";

const CHANNELS: Channel[] = ["email", "call", "mail"];
const BOX_LABEL: Record<Channel, string> = { email: "Do not email", call: "Do not call", mail: "Do not mail" };

type Pending = { channel: Channel; optOut: boolean; method: string; note: string };

/** Do not email / call / mail boxes, each change recorded with how and when. */
export default function PreferencesCard({
  contact,
  log,
  onChanged,
}: {
  contact: ContactSummary;
  log: PreferenceLog[];
  onChanged: () => void;
}) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const isOut = (ch: Channel) =>
    ch === "email" ? contact.do_not_email : ch === "call" ? contact.do_not_call : contact.do_not_mail;

  function status(ch: Channel): string | null {
    if (!isOut(ch)) return null;
    const last = log.find((l) => l.channel === ch && l.action === "opt_out");
    if (last) return `Since ${shortDate(last.created_at)}${last.method ? `, ${last.method.toLowerCase()}` : ""}${last.by_name ? ` (recorded by ${last.by_name})` : ""}`;
    if (ch === "email" && contact.unsubscribed_at)
      return `Since ${shortDate(contact.unsubscribed_at)}${contact.unsubscribe_reason ? `, ${contact.unsubscribe_reason.toLowerCase()}` : ""}`;
    return "No date recorded";
  }

  async function save() {
    if (!pending) return;
    if (!pending.optOut && !pending.note.trim()) return setError("Note when and how they agreed to hear from DHA again.");
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("set_contact_preference", {
      p_contact: contact.id,
      p_channel: pending.channel,
      p_opt_out: pending.optOut,
      p_method: pending.method,
      p_note: pending.note,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setPending(null);
    onChanged();
  }

  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Contact preferences</h2>
        {log.length > 0 && (
          <button className="text-sm font-semibold text-teal-700" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide history" : `History (${log.length})`}
          </button>
        )}
      </div>
      <p className="muted text-sm">
        Tick a box when someone asks not to be contacted that way, by phone, in person or in writing. Emails from the CRM
        are never sent to people marked &ldquo;Do not email,&rdquo; and the unsubscribe link in every email ticks that box
        automatically.
      </p>

      <div className="mt-3 flex flex-col gap-2">
        {CHANNELS.map((ch) => {
          const out = isOut(ch);
          const open = pending?.channel === ch;
          return (
            <div key={ch} className={`rounded-lg border p-3 ${out ? "border-[#e8c9bb] bg-coral-100/40" : "border-[var(--border)]"}`}>
              <label className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={open ? pending!.optOut : out}
                  onChange={(e) => {
                    setError(null);
                    if (e.target.checked === out) return setPending(null);
                    setPending({ channel: ch, optOut: e.target.checked, method: e.target.checked ? "Phone call" : "Phone call", note: "" });
                  }}
                />
                <span className="font-semibold">{BOX_LABEL[ch]}</span>
                {out && !open && <span className="muted text-xs">{status(ch)}</span>}
              </label>

              {open && pending && (
                <div className="mt-3 grid gap-3 md:grid-cols-6">
                  <div className="md:col-span-2">
                    <label className="label">{pending.optOut ? "How did they ask?" : "How did they agree?"}</label>
                    <select className="input mt-1" value={pending.method} onChange={(e) => setPending({ ...pending, method: e.target.value })}>
                      {OPT_OUT_METHODS.map((m) => <option key={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="md:col-span-4">
                    <label className="label">{pending.optOut ? "Note (optional)" : "When and how did they agree to hear from DHA again?"}</label>
                    <input
                      className="input mt-1"
                      autoFocus
                      placeholder={pending.optOut ? "e.g. Asked during a thank-you call" : "e.g. Said yes on the phone on 11/3"}
                      value={pending.note}
                      onChange={(e) => setPending({ ...pending, note: e.target.value })}
                    />
                  </div>
                  {!pending.optOut && ch === "email" && contact.unsubscribed_at && (
                    <p className="text-sm text-[#b8862e] md:col-span-6">
                      They unsubscribed{contact.unsubscribe_reason ? ` (${contact.unsubscribe_reason.toLowerCase()})` : ""}. Only
                      turn emails back on if they have asked to receive them again.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 md:col-span-6">
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
                      {busy ? "Saving…" : pending.optOut ? `Save: ${BOX_LABEL[ch].toLowerCase()}` : `Resubscribe to ${CHANNEL_LABELS[ch].toLowerCase()}`}
                    </button>
                    <button className="btn btn-secondary btn-sm" onClick={() => { setPending(null); setError(null); }}>Cancel</button>
                    {error && <span className="text-sm text-coral-600">{error}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {showHistory && (
        <ul className="mt-3 flex flex-col gap-1 text-sm">
          {log.map((l) => (
            <li key={l.id} className="border-t border-[var(--border)] pt-1">
              <strong>{l.action === "opt_out" ? BOX_LABEL[l.channel] : `Resubscribed to ${CHANNEL_LABELS[l.channel].toLowerCase()}`}</strong>
              {" · "}
              {shortDate(l.created_at)}
              {l.method ? ` · ${l.method}` : ""}
              {l.by_name ? ` · ${l.by_name}` : ""}
              {l.note && <div className="muted text-xs">{l.note}</div>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
