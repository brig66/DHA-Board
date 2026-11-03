"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchAll, fetchAllContacts } from "@/lib/data";
import { downloadCsv, fullName, money, shortDate } from "@/lib/format";
import { CHANNEL_LABELS, OPT_OUT_METHODS, type Channel, type ContactSummary, type OutreachNote, type PreferenceLog } from "@/lib/types";

type Row = {
  c: ContactSummary & { unsubscribe_reviewed_at?: string | null };
  channels: Channel[];
  since: string | null;
  how: string | null;
  note: OutreachNote | null;
  toReview: boolean;
};

const outOf = (c: ContactSummary): Channel[] =>
  [c.do_not_email && "email", c.do_not_call && "call", c.do_not_mail && "mail"].filter(Boolean) as Channel[];

export default function UnsubscribedPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState<"" | Channel>("");
  const [phoneOnly, setPhoneOnly] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  const [resub, setResub] = useState<{ id: string; channels: Channel[]; method: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    try {
      const [contacts, log, notes, reviewed] = await Promise.all([
        fetchAllContacts(supabase),
        fetchAll<PreferenceLog>(supabase, "contact_preference_log", "*"),
        fetchAll<OutreachNote>(supabase, "outreach_notes", "*"),
        fetchAll<{ id: string; unsubscribe_reviewed_at: string | null }>(
          supabase, "contacts", "id, unsubscribe_reviewed_at"
        ),
      ]);
      const reviewedAt = new Map(reviewed.map((r) => [r.id, r.unsubscribe_reviewed_at]));
      // the latest entry per person and channel (an opt-out may have been reversed since)
      const latest = new Map<string, PreferenceLog>();
      for (const l of log) {
        const k = `${l.contact_id}|${l.channel}`;
        const prev = latest.get(k);
        if (!prev || l.created_at > prev.created_at) latest.set(k, l);
      }
      /** When and how they opted out of what they're opted out of now (the most recent one). */
      const sinceHow = (c: ContactSummary, channels: Channel[]): { since: string | null; how: string | null } => {
        let best: { since: string | null; how: string | null } = { since: null, how: null };
        const offer = (since: string | null, how: string | null) => {
          if (since && (!best.since || since > best.since)) best = { since, how };
        };
        for (const ch of channels) {
          const l = latest.get(`${c.id}|${ch}`);
          const logged = l && l.action === "opt_out" ? l : null;
          if (logged)
            offer(logged.created_at, `${CHANNEL_LABELS[ch]}: ${[logged.method, logged.by_name && `recorded by ${logged.by_name}`].filter(Boolean).join(", ")}`);
          // the unsubscribe link records the date on the person, not in the log
          if (ch === "email" && c.unsubscribed_at && (!logged || c.unsubscribed_at > logged.created_at))
            offer(c.unsubscribed_at, `Email: ${c.unsubscribe_reason ?? "unsubscribe link"}`);
        }
        return best;
      };
      const latestNote = new Map<string, OutreachNote>();
      for (const n of notes) {
        const prev = latestNote.get(n.contact_id);
        if (!prev || n.created_at > prev.created_at) latestNote.set(n.contact_id, n);
      }
      setRows(
        contacts
          .filter((c) => !c.is_anonymous && outOf(c).length > 0)
          .map((c) => {
            const reviewedOn = reviewedAt.get(c.id) ?? null;
            const channels = outOf(c);
            return {
              c: { ...c, unsubscribe_reviewed_at: reviewedOn },
              channels,
              ...sinceHow(c, channels),
              note: latestNote.get(c.id) ?? null,
              toReview: !!c.unsubscribed_at && !reviewedOn,
            };
          })
          .sort((a, b) => Number(b.toReview) - Number(a.toReview) || (b.since ?? "").localeCompare(a.since ?? ""))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const digits = q.replace(/\D/g, "");
    return rows.filter((r) => {
      if (channel && !r.channels.includes(channel)) return false;
      if (phoneOnly && !r.c.phone) return false;
      if (reviewOnly && !r.toReview) return false;
      if (q) {
        const hay = [r.c.first_name, r.c.last_name, r.c.organization, r.c.email].join(" ").toLowerCase();
        const phoneHit = digits.length >= 4 && (r.c.phone ?? "").replace(/\D/g, "").includes(digits);
        if (!hay.includes(q) && !phoneHit) return false;
      }
      return true;
    });
  }, [rows, search, channel, phoneOnly, reviewOnly]);

  const counts = useMemo(
    () => ({
      email: rows.filter((r) => r.channels.includes("email")).length,
      call: rows.filter((r) => r.channels.includes("call")).length,
      mail: rows.filter((r) => r.channels.includes("mail")).length,
      review: rows.filter((r) => r.toReview).length,
    }),
    [rows]
  );

  async function markReviewed(id: string) {
    const { error } = await createClient().from("contacts").update({ unsubscribe_reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) return setError(error.message);
    load();
  }

  async function addNote(id: string) {
    if (!noteText.trim()) return;
    setBusy(true);
    const { error } = await createClient().rpc("add_outreach_note", { p_contact: id, p_note: noteText });
    setBusy(false);
    if (error) return setError(error.message);
    setNoteFor(null);
    setNoteText("");
    load();
  }

  async function resubscribe() {
    if (!resub) return;
    if (!resub.channels.length) return setError("Choose what they agreed to.");
    if (!resub.note.trim()) return setError("Note when and how they agreed to hear from DHA again.");
    setBusy(true);
    setError(null);
    const supabase = createClient();
    for (const ch of resub.channels) {
      const { error } = await supabase.rpc("set_contact_preference", {
        p_contact: resub.id, p_channel: ch, p_opt_out: false, p_method: resub.method, p_note: resub.note,
      });
      if (error) {
        setBusy(false);
        return setError(error.message);
      }
    }
    setBusy(false);
    setResub(null);
    load();
  }

  function exportShown() {
    downloadCsv(
      `DHA opted out ${new Date().toISOString().slice(0, 10)}.csv`,
      ["First Name", "Last Name", "Organization", "Email", "Phone", "Do Not Email", "Do Not Call", "Do Not Mail", "Since", "How",
        "Lifetime Giving", "Last Gift", "Latest Note"],
      shown.map((r) => [
        r.c.first_name, r.c.last_name, r.c.organization, r.c.email, r.c.phone,
        r.channels.includes("email") ? "Yes" : "", r.channels.includes("call") ? "Yes" : "", r.channels.includes("mail") ? "Yes" : "",
        r.since ? r.since.slice(0, 10) : "", r.how, Number(r.c.total_given).toFixed(2), r.c.last_gift_date, r.note?.note,
      ])
    );
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-2xl font-semibold">Unsubscribed and opted out</h1>
        <p className="muted max-w-3xl text-sm">
          Everyone who asked not to be emailed, called or mailed, whether through the unsubscribe link or by telling DHA.
          Use this list to call past donors who stopped getting emails. Respect &ldquo;Do not call&rdquo;: those people are
          marked in red. If someone agrees to hear from DHA again, click <strong>Resubscribe</strong> and note when they said
          yes.
        </p>
      </div>
      {error && <p className="text-sm text-coral-600">{error}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Tile label="Opted out of something" value={rows.length} />
        <Tile label="Do not email" value={counts.email} />
        <Tile label="Do not call" value={counts.call} />
        <Tile label="Do not mail" value={counts.mail} />
        <Tile label="New, to review" value={counts.review} warn={counts.review > 0} />
      </div>

      <div className="card grid gap-3 p-4 md:grid-cols-6">
        <div className="md:col-span-2">
          <label className="label">Search</label>
          <input className="input mt-1" placeholder="Name, email or phone…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div>
          <label className="label">Opted out of</label>
          <select className="input mt-1" value={channel} onChange={(e) => setChannel(e.target.value as typeof channel)}>
            <option value="">Anything</option>
            <option value="email">Email</option>
            <option value="call">Calls</option>
            <option value="mail">Mail</option>
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={phoneOnly} onChange={(e) => setPhoneOnly(e.target.checked)} />
          Has a phone number
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={reviewOnly} onChange={(e) => setReviewOnly(e.target.checked)} />
          New, to review
        </label>
        <div className="flex items-end">
          <button className="btn btn-secondary w-full" onClick={exportShown}>Download for Excel</button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Opted out of</th>
              <th>Since</th>
              <th>Phone</th>
              <th>Giving</th>
              <th>Latest note</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <Fragment key={r.c.id}>
                <tr className={r.toReview ? "bg-[#fdf8ec]" : ""}>
                  <td>
                    <Link href={`/donors/${r.c.id}`} className="font-semibold text-teal-700">{fullName(r.c)}</Link>
                    {r.c.organization && r.c.organization !== r.c.last_name && <div className="muted text-xs">{r.c.organization}</div>}
                    <div className="muted break-all text-xs">{r.c.email ?? "No email"}</div>
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {r.channels.map((ch) => <span key={ch} className="pill pill-bad">{CHANNEL_LABELS[ch]}</span>)}
                    </div>
                  </td>
                  <td className="text-sm">
                    {r.since ? shortDate(r.since) : "—"}
                    {r.how && <div className="muted text-xs">{r.how}</div>}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.c.phone ? (
                      r.c.do_not_call ? <span className="muted line-through">{r.c.phone}</span> : <a className="text-teal-700" href={`tel:${r.c.phone.replace(/\D/g, "")}`}>{r.c.phone}</a>
                    ) : "—"}
                  </td>
                  <td className="text-sm">
                    {money(r.c.total_given)}
                    <div className="muted text-xs">{r.c.last_gift_date ? `last gift ${shortDate(r.c.last_gift_date)}` : "no gifts"}</div>
                  </td>
                  <td className="max-w-xs text-sm">
                    {r.note ? (
                      <>
                        {r.note.note}
                        <div className="muted text-xs">{shortDate(r.note.created_at)}{r.note.by_name ? ` · ${r.note.by_name}` : ""}</div>
                      </>
                    ) : <span className="muted">—</span>}
                    {noteFor !== r.c.id && (
                      <div>
                        <button className="text-xs font-semibold text-teal-700" onClick={() => { setNoteFor(r.c.id); setNoteText(""); }}>+ Add note</button>
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {r.toReview && (
                      <button className="btn btn-primary btn-sm mr-2" onClick={() => markReviewed(r.c.id)}>Mark reviewed</button>
                    )}
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setError(null); setResub({ id: r.c.id, channels: r.channels, method: "Phone call", note: "" }); }}
                    >
                      Resubscribe…
                    </button>
                  </td>
                </tr>
                {noteFor === r.c.id && (
                  <tr>
                    <td colSpan={7} className="bg-[#faf8f3]">
                      <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); addNote(r.c.id); }}>
                        <input className="input min-w-64 flex-1" autoFocus placeholder="e.g. Called 11/5, left a voicemail"
                          value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                        <button className="btn btn-primary btn-sm" disabled={busy || !noteText.trim()}>Save note</button>
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setNoteFor(null)}>Cancel</button>
                      </form>
                    </td>
                  </tr>
                )}
                {resub?.id === r.c.id && (
                  <tr>
                    <td colSpan={7} className="bg-[#faf8f3]">
                      <div className="grid gap-3 md:grid-cols-6">
                        <div className="md:col-span-2">
                          <span className="label">They agreed to hear from DHA by</span>
                          <div className="mt-1 flex flex-wrap gap-3 text-sm">
                            {r.channels.map((ch) => (
                              <label key={ch} className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={resub.channels.includes(ch)}
                                  onChange={(e) =>
                                    setResub({
                                      ...resub,
                                      channels: e.target.checked ? [...resub.channels, ch] : resub.channels.filter((x) => x !== ch),
                                    })
                                  }
                                />
                                {CHANNEL_LABELS[ch]}
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="label">How</label>
                          <select className="input mt-1" value={resub.method} onChange={(e) => setResub({ ...resub, method: e.target.value })}>
                            {OPT_OUT_METHODS.map((m) => <option key={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="md:col-span-3">
                          <label className="label">When and how did they agree?</label>
                          <input className="input mt-1" autoFocus placeholder="e.g. Said yes on the phone on 11/5"
                            value={resub.note} onChange={(e) => setResub({ ...resub, note: e.target.value })} />
                        </div>
                        <div className="flex flex-wrap gap-2 md:col-span-6">
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={resubscribe}>
                            {busy ? "Saving…" : "Resubscribe"}
                          </button>
                          <button className="btn btn-secondary btn-sm" onClick={() => setResub(null)}>Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={7} className="muted p-6 text-center">{rows.length ? "Nobody matches these filters." : "Nobody has opted out."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Tile({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`card p-4 ${warn ? "border-2 border-[#e2c27a]" : ""}`}>
      <div className="label">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${warn ? "text-[#b8862e]" : "text-teal-700"}`}>{value.toLocaleString()}</div>
    </div>
  );
}
