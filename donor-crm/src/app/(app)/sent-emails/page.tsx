"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { fetchAll } from "@/lib/data";
import { downloadCsv, shortDate } from "@/lib/format";
import { deliveryOf, isTracked } from "@/lib/emailStatus";
import EmailPreview from "@/components/EmailPreview";
import { buildEmailHtml } from "../../../../supabase/functions/_shared/email-html";
import type { EmailLog } from "@/lib/types";

type Row = EmailLog & { mailing: string };
type Donor = {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  do_not_email: boolean;
  unsubscribed_at: string | null;
  unsubscribe_reason: string | null;
  unsubscribe_reviewed_at: string | null;
};
type Mailing = {
  key: string;
  date: string;
  subject: string;
  sentBy: string;
  total: number;
  delivered: number;
  bad: number;
  tracked: number;
  opened: number;
  unsubscribed: number;
};

const SHOW_FILTERS = [
  { value: "", label: "All emails" },
  { value: "bad", label: "Not delivered" },
  { value: "delivered", label: "Delivered" },
  { value: "opened", label: "Opened" },
  { value: "unopened", label: "Not opened" },
  { value: "unsub", label: "Unsubscribed" },
];

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");
const dateTime = (d: string) =>
  new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const name = (d: Pick<Donor, "first_name" | "last_name"> | undefined) =>
  d ? [d.first_name, d.last_name].filter(Boolean).join(" ") || "(no name)" : "(donor removed)";

/** Emails sent in one go share a mailing id; older ones are grouped by subject and day. */
const mailingKey = (m: EmailLog) => m.batch_id ?? `${m.subject}|${m.sent_at.slice(0, 10)}`;

export default function SentEmailsPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [donors, setDonors] = useState<Map<string, Donor>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [show, setShow] = useState("");
  const [mailing, setMailing] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [limit, setLimit] = useState(100);
  const [allMailings, setAllMailings] = useState(false);
  const [showReviewed, setShowReviewed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  async function load() {
    const supabase = createClient();
    try {
      const [logs, people] = await Promise.all([
        fetchAll<EmailLog>(supabase, "email_log"),
        fetchAll<Donor>(
          supabase,
          "contacts",
          "id, first_name, last_name, email, do_not_email, unsubscribed_at, unsubscribe_reason, unsubscribe_reviewed_at"
        ),
      ]);
      logs.sort((a, b) => b.sent_at.localeCompare(a.sent_at));
      setRows(logs.map((m) => ({ ...m, mailing: mailingKey(m) })));
      setDonors(new Map(people.map((p) => [p.id, p])));
    } catch (e) {
      setError((e as Error).message);
    }
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const donorOf = (m: EmailLog) => (m.contact_id ? donors.get(m.contact_id) : undefined);

  const unsubscribed = useMemo(() => {
    const list = Array.from(donors.values()).filter((d) => d.unsubscribed_at);
    // the email they unsubscribed from, if we know it
    const fromEmail = new Map<string, EmailLog>();
    for (const m of rows) if (m.unsubscribed_at && m.contact_id && !fromEmail.has(m.contact_id)) fromEmail.set(m.contact_id, m);
    list.sort((a, b) => (b.unsubscribed_at ?? "").localeCompare(a.unsubscribed_at ?? ""));
    return { pending: list.filter((d) => !d.unsubscribe_reviewed_at), reviewed: list.filter((d) => d.unsubscribe_reviewed_at), fromEmail };
  }, [donors, rows]);

  const mailings = useMemo(() => {
    const map = new Map<string, Mailing>();
    for (const m of rows) {
      let g = map.get(m.mailing);
      if (!g) {
        g = { key: m.mailing, date: m.sent_at, subject: m.subject, sentBy: m.sent_by_name ?? "—", total: 0, delivered: 0, bad: 0, tracked: 0, opened: 0, unsubscribed: 0 };
        map.set(m.mailing, g);
      }
      if (m.sent_at < g.date) g.date = m.sent_at;
      const d = deliveryOf(m);
      g.total++;
      if (d.kind === "delivered") g.delivered++;
      if (d.kind === "bad") g.bad++;
      if (isTracked(m)) g.tracked++;
      if (m.first_opened_at) g.opened++;
      if (m.unsubscribed_at) g.unsubscribed++;
    }
    return Array.from(map.values()).sort((a, b) => b.date.localeCompare(a.date));
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((m) => {
      if (mailing && m.mailing !== mailing) return false;
      const day = m.sent_at.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      const d = deliveryOf(m);
      if (show === "bad" && d.kind !== "bad") return false;
      if (show === "delivered" && d.kind !== "delivered") return false;
      if (show === "opened" && !m.first_opened_at) return false;
      if (show === "unopened" && (m.first_opened_at || !isTracked(m) || d.kind === "bad")) return false;
      if (show === "unsub" && !(m.unsubscribed_at || donorOf(m)?.unsubscribed_at)) return false;
      if (term) {
        const hay = [name(donorOf(m)), m.to_email, m.subject, m.sent_by_name].join(" ").toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, donors, q, show, mailing, from, to]);

  const totals = useMemo(() => {
    const tracked = filtered.filter(isTracked);
    return {
      sent: filtered.length,
      delivered: filtered.filter((m) => deliveryOf(m).kind === "delivered").length,
      bad: filtered.filter((m) => deliveryOf(m).kind === "bad").length,
      tracked: tracked.length,
      opened: tracked.filter((m) => m.first_opened_at).length,
      unsub: filtered.filter((m) => m.unsubscribed_at).length,
    };
  }, [filtered]);

  async function markReviewed(id: string, reviewed: boolean) {
    const { error } = await createClient()
      .from("contacts")
      .update({ unsubscribe_reviewed_at: reviewed ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) return setError(error.message);
    setDonors((prev) => {
      const next = new Map(prev);
      const d = next.get(id);
      if (d) next.set(id, { ...d, unsubscribe_reviewed_at: reviewed ? new Date().toISOString() : null });
      return next;
    });
  }

  function exportRows() {
    downloadCsv(
      `DHA sent emails ${new Date().toISOString().slice(0, 10)}.csv`,
      ["Sent", "Donor", "Email address", "Subject", "Sent by", "Delivery", "Delivery detail", "First opened", "Times opened", "Unsubscribed"],
      filtered.map((m) => {
        const d = deliveryOf(m);
        return [
          dateTime(m.sent_at),
          name(donorOf(m)),
          m.to_email,
          m.subject,
          m.sent_by_name,
          d.label,
          d.detail,
          m.first_opened_at ? dateTime(m.first_opened_at) : isTracked(m) ? "" : "Not tracked",
          isTracked(m) ? m.open_count : "",
          m.unsubscribed_at ? dateTime(m.unsubscribed_at) : "",
        ];
      })
    );
  }

  if (loading) return <p className="muted">Loading…</p>;

  const shownMailings = allMailings ? mailings : mailings.slice(0, 6);
  const anyFilter = q || show || mailing || from || to;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Sent Emails</h1>
          <p className="muted text-sm">
            Every email sent from the CRM: who got it, whether it arrived, whether it was opened, and who unsubscribed.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={exportRows} disabled={!filtered.length}>
          Download for Excel
        </button>
      </div>
      {error && <p className="text-coral-600">{error}</p>}

      {/* donors who asked to stop receiving emails */}
      <section className={`card overflow-hidden ${unsubscribed.pending.length ? "border-2 border-[#e2c27a]" : ""}`}>
        <div className={`flex flex-wrap items-center justify-between gap-2 p-4 ${unsubscribed.pending.length ? "bg-[#fbf3df]" : ""}`}>
          <div>
            <h2 className="font-display text-lg font-semibold">
              Unsubscribed donors{" "}
              {unsubscribed.pending.length > 0 && <span className="pill pill-warn align-middle">{unsubscribed.pending.length} to review</span>}
            </h2>
            <p className="muted text-sm">
              These donors asked to stop receiving emails. They are marked <strong>Do not email</strong> and the CRM will skip
              them. Decide how to stay in touch, then mark each one reviewed.
            </p>
          </div>
          {unsubscribed.reviewed.length > 0 && (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowReviewed(!showReviewed)}>
              {showReviewed ? "Hide" : "Show"} reviewed ({unsubscribed.reviewed.length})
            </button>
          )}
        </div>
        {unsubscribed.pending.length === 0 && !showReviewed ? (
          <p className="muted px-4 pb-4 text-sm">No one is waiting for review.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>Donor</th>
                  <th>Email address</th>
                  <th>Unsubscribed</th>
                  <th>How</th>
                  <th>From the email</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...unsubscribed.pending, ...(showReviewed ? unsubscribed.reviewed : [])].map((d) => {
                  const m = unsubscribed.fromEmail.get(d.id);
                  return (
                    <tr key={d.id} className={d.unsubscribe_reviewed_at ? "" : "bg-[#fdf8ec]"}>
                      <td>
                        <Link href={`/donors/${d.id}`} className="font-semibold text-teal-700">{name(d)}</Link>
                      </td>
                      <td>{d.email ?? "—"}</td>
                      <td className="whitespace-nowrap">{shortDate(d.unsubscribed_at)}</td>
                      <td className="text-sm">{d.unsubscribe_reason ?? "—"}</td>
                      <td className="text-sm">{m ? m.subject : "—"}</td>
                      <td className="whitespace-nowrap text-right">
                        {d.unsubscribe_reviewed_at ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => markReviewed(d.id, false)}>
                            Reviewed {shortDate(d.unsubscribe_reviewed_at)} · undo
                          </button>
                        ) : (
                          <button className="btn btn-primary btn-sm" onClick={() => markReviewed(d.id, true)}>Mark reviewed</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* one line per mailing */}
      <section className="card overflow-hidden">
        <div className="p-4">
          <h2 className="font-display text-lg font-semibold">Mailings</h2>
          <p className="muted text-sm">Each time an email went out. Click one to see every recipient below.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Subject</th>
                <th>Sent by</th>
                <th className="text-right">Recipients</th>
                <th className="text-right">Delivered</th>
                <th className="text-right">Not delivered</th>
                <th className="text-right">Opened</th>
                <th className="text-right">Unsubscribed</th>
              </tr>
            </thead>
            <tbody>
              {shownMailings.map((g) => (
                <tr
                  key={g.key}
                  className={`cursor-pointer ${mailing === g.key ? "bg-[#eef6f8]" : ""}`}
                  onClick={() => {
                    setMailing(mailing === g.key ? "" : g.key);
                    setLimit(100);
                  }}
                >
                  <td className="whitespace-nowrap">{dateTime(g.date)}</td>
                  <td className="font-semibold text-teal-700">{g.subject}</td>
                  <td>{g.sentBy}</td>
                  <td className="text-right">{g.total}</td>
                  <td className="text-right">{g.tracked ? `${g.delivered} (${pct(g.delivered, g.total)})` : <span className="muted">Not tracked</span>}</td>
                  <td className={`text-right ${g.bad ? "font-semibold text-coral-600" : ""}`}>{g.bad}</td>
                  <td className="text-right">{g.tracked ? `${g.opened} (${pct(g.opened, g.tracked - g.bad)})` : <span className="muted">Not tracked</span>}</td>
                  <td className={`text-right ${g.unsubscribed ? "font-semibold text-[#b8862e]" : ""}`}>{g.unsubscribed}</td>
                </tr>
              ))}
              {!mailings.length && (
                <tr>
                  <td colSpan={8} className="muted">No emails have been sent yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {mailings.length > 6 && (
          <div className="p-3">
            <button className="btn btn-secondary btn-sm" onClick={() => setAllMailings(!allMailings)}>
              {allMailings ? "Show fewer" : `Show all ${mailings.length} mailings`}
            </button>
          </div>
        )}
      </section>

      {/* every email */}
      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[14rem] flex-1">
            <label className="label">Search</label>
            <input className="input mt-1" placeholder="Donor, email address, subject or sender" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div>
            <label className="label">Show</label>
            <select className="input mt-1" value={show} onChange={(e) => setShow(e.target.value)}>
              {SHOW_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label block">Mailing</label>
            <select className="input mt-1 max-w-[16rem]" value={mailing} onChange={(e) => setMailing(e.target.value)}>
              <option value="">All mailings</option>
              {mailings.map((g) => (
                <option key={g.key} value={g.key}>
                  {shortDate(g.date)}: {g.subject} ({g.total})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">From</label>
            <input type="date" className="input mt-1" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input mt-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          {anyFilter && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setQ(""); setShow(""); setMailing(""); setFrom(""); setTo(""); }}>
              Clear
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 px-4 pb-4 md:grid-cols-5">
          <Tile label="Emails" value={String(totals.sent)} />
          <Tile label="Delivered" value={totals.tracked ? `${totals.delivered} (${pct(totals.delivered, totals.tracked)})` : "—"} />
          <Tile label="Not delivered" value={String(totals.bad)} tone={totals.bad ? "bad" : undefined} />
          <Tile label="Opened" value={totals.tracked ? `${totals.opened} (${pct(totals.opened, totals.tracked - totals.bad)})` : "—"} />
          <Tile label="Unsubscribed" value={String(totals.unsub)} tone={totals.unsub ? "warn" : undefined} />
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Donor</th>
                <th>Subject</th>
                <th>Sent by</th>
                <th>Delivery</th>
                <th>Opened</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, limit).map((m) => {
                const d = deliveryOf(m);
                const donor = donorOf(m);
                const unsub = !!(m.unsubscribed_at || donor?.unsubscribed_at);
                return (
                  <Fragment key={m.id}>
                    <tr className={`cursor-pointer ${unsub ? "bg-[#fdf3dc]" : ""}`} onClick={() => setOpen(open === m.id ? null : m.id)}>
                      <td className="whitespace-nowrap text-sm">{dateTime(m.sent_at)}</td>
                      <td>
                        {donor ? (
                          <Link href={`/donors/${donor.id}`} className="font-semibold text-teal-700" onClick={(e) => e.stopPropagation()}>
                            {name(donor)}
                          </Link>
                        ) : (
                          <span className="muted">{name(donor)}</span>
                        )}
                        <div className="muted text-xs">{m.to_email}</div>
                        {unsub && (
                          <span className="pill pill-warn mt-1">
                            Unsubscribed {shortDate(m.unsubscribed_at ?? donor?.unsubscribed_at)}
                          </span>
                        )}
                      </td>
                      <td className="text-sm">{m.subject}</td>
                      <td className="text-sm">{m.sent_by_name ?? "—"}</td>
                      <td>
                        <span className={`pill ${d.kind === "bad" ? "pill-bad" : d.kind === "delivered" ? "pill-good" : ""}`}>{d.label}</span>
                        {d.detail && <div className="muted mt-1 max-w-[16rem] text-xs">{d.detail}</div>}
                      </td>
                      <td className="whitespace-nowrap text-sm">
                        {m.first_opened_at ? (
                          <>
                            <span className="pill pill-good">Opened</span>
                            <div className="muted text-xs">
                              {shortDate(m.first_opened_at)}
                              {m.open_count > 1 ? ` · ${m.open_count} times` : ""}
                            </div>
                          </>
                        ) : isTracked(m) ? (
                          d.kind === "bad" ? "—" : <span className="muted">Not yet</span>
                        ) : (
                          <span className="muted text-xs">Not tracked</span>
                        )}
                      </td>
                    </tr>
                    {open === m.id && (
                      <tr>
                        <td colSpan={6} className="bg-[#faf8f3]">
                          {m.body_html ? (
                            <EmailPreview className="block w-full max-w-[640px] rounded border-0" html={buildEmailHtml(m.body_html, "")} />
                          ) : (
                            <div className="whitespace-pre-wrap text-sm">{m.body}</div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {!filtered.length && (
                <tr>
                  <td colSpan={6} className="muted">No emails match.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > limit && (
          <div className="p-3">
            <button className="btn btn-secondary btn-sm" onClick={() => setLimit(limit + 200)}>
              Show more ({filtered.length - limit} not shown)
            </button>
          </div>
        )}
      </section>

      <p className="muted text-xs">
        About opens: an email counts as opened when the reader&rsquo;s email program shows its pictures. Some programs (such as
        Apple Mail) load pictures automatically, which can count an email as opened before it is read, and readers who block
        pictures won&rsquo;t show as opened. Treat open counts as a guide rather than an exact figure. Emails sent before{" "}
        tracking started show &ldquo;Not tracked&rdquo;.
      </p>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: "bad" | "warn" }) {
  const color = tone === "bad" ? "text-coral-600" : tone === "warn" ? "text-[#b8862e]" : "text-teal-700";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-white p-3">
      <div className="label">{label}</div>
      <div className={`mt-1 font-display text-xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
