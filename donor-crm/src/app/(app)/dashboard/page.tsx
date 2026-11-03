"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAll, fetchAllContacts, setEmailRecipients } from "@/lib/data";
import { fullName, money, shortDate } from "@/lib/format";
import { thankStatus, thankYouEmailsByContact, todayLocal, type EmailLite } from "@/lib/thanks";
import { THANK_METHODS, type ContactSummary, type GiftType } from "@/lib/types";

type Gift = {
  id: string;
  contact_id: string;
  gift_date: string;
  amount: number;
  event_name: string;
  gift_type: GiftType;
  thanked_on: string | null;
  thanked_method: string | null;
  thanked_by_name: string | null;
};
type ItemLite = { donation_id: string | null; event_name: string; sold_amount: number | null; fair_market_value: number | null };

export default function DashboardPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [emails, setEmails] = useState<EmailLite[]>([]);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    try {
      const [c, g, e, i] = await Promise.all([
        fetchAllContacts(supabase),
        fetchAll<Gift>(supabase, "donations", "id, contact_id, gift_date, amount, event_name, gift_type, thanked_on, thanked_method, thanked_by_name"),
        fetchAll<EmailLite>(supabase, "email_log", "contact_id, sent_at, subject, template_name, status"),
        fetchAll<ItemLite>(supabase, "inkind_items", "donation_id, event_name, sold_amount, fair_market_value"),
      ]);
      setContacts(c);
      setGifts(g);
      setEmails(e);
      setItems(i);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const byId = new Map(contacts.map((c) => [c.id, c]));
    const named = contacts.filter((c) => !c.is_anonymous);

    // An auction item counts once in "Total raised": at what it sold for once
    // it sells (the buyer's payment), or at its market value until then. Its
    // donor's in-kind gift carries the market value; an item with no donor
    // recorded yet is counted here directly.
    const soldGiftIds = new Set(items.filter((i) => i.sold_amount !== null && i.donation_id).map((i) => i.donation_id!));
    const counted = gifts.filter((g) => !soldGiftIds.has(g.id));
    const auctionSales = items.reduce((s, i) => s + Number(i.sold_amount ?? 0), 0);
    const unsoldNoGift = items.filter((i) => i.sold_amount === null && !i.donation_id);
    const total =
      counted.reduce((s, g) => s + Number(g.amount), 0) +
      auctionSales +
      unsoldNoGift.reduce((s, i) => s + Number(i.fair_market_value ?? 0), 0);

    const byEvent = new Map<string, { donors: Set<string>; gifts: number; total: number; auction: number; latest: string }>();
    const ev = (name: string) => {
      let e = byEvent.get(name);
      if (!e) byEvent.set(name, (e = { donors: new Set(), gifts: 0, total: 0, auction: 0, latest: "" }));
      return e;
    };
    for (const g of gifts) {
      const e = ev(g.event_name);
      e.donors.add(g.contact_id);
      e.gifts += 1;
      if (!soldGiftIds.has(g.id)) e.total += Number(g.amount);
      if (g.gift_date > e.latest) e.latest = g.gift_date;
    }
    for (const i of items) {
      if (i.sold_amount === null) {
        if (!i.donation_id && Number(i.fair_market_value ?? 0) > 0) ev(i.event_name).total += Number(i.fair_market_value);
        continue;
      }
      const e = ev(i.event_name);
      e.auction += Number(i.sold_amount);
      e.total += Number(i.sold_amount);
    }
    const events = Array.from(byEvent.entries())
      .map(([name, e]) => ({ name, donors: e.donors.size, gifts: e.gifts, total: e.total, auction: e.auction, latest: e.latest }))
      .sort((a, b) => b.latest.localeCompare(a.latest));

    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const cutoff = yearAgo.toISOString().slice(0, 10);

    // gave before, nothing in the past 12 months (with or without an email address)
    const renewals = named
      .filter((c) => c.last_gift_date && c.last_gift_date < cutoff)
      .sort((a, b) => Number(b.total_given) - Number(a.total_given));

    // every gift from the past 12 months that nobody has thanked yet
    const thankEmails = thankYouEmailsByContact(emails);
    const thankYous = gifts
      .filter((g) => g.gift_date >= cutoff)
      .map((g) => ({ gift: g, contact: byId.get(g.contact_id) }))
      .filter((x): x is { gift: Gift; contact: ContactSummary } => !!x.contact && !x.contact.is_anonymous)
      .filter((x) => thankStatus(x.gift, thankEmails).kind === "needed")
      .sort((a, b) => b.gift.gift_date.localeCompare(a.gift.gift_date));

    const repeat = named.filter((c) => c.gift_years.length > 1).length;
    const donors = named.filter((c) => c.gift_count > 0).length;
    const attendeesOnly = named.filter((c) => c.gift_count === 0 && c.events_attended).length;
    const eventNames = Array.from(new Set(gifts.map((g) => g.event_name))).sort();

    return { total, auctionSales, events, renewals, thankYous, repeat, donors, attendeesOnly, eventNames };
  }, [contacts, gifts, emails, items]);

  function emailGroup(list: ContactSummary[], template: string) {
    setEmailRecipients(Array.from(new Set(list.map((c) => c.id))));
    router.push(`/email?template=${encodeURIComponent(template)}`);
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="text-coral-600">{error}</p>;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="font-display text-2xl font-semibold">Dashboard</h1>
        <p className="muted text-sm">A snapshot of every donor and gift in the CRM.</p>
      </div>

      <div className={`grid grid-cols-2 gap-4 ${stats.auctionSales > 0 ? "md:grid-cols-6" : "md:grid-cols-5"}`}>
        <Tile label="Donors" value={stats.donors.toLocaleString()} />
        <Tile label="Event guests, no gifts yet" value={stats.attendeesOnly.toLocaleString()} />
        <Tile label="Total raised" value={money(stats.total)} />
        {stats.auctionSales > 0 && <Tile label="Auction sales" value={money(stats.auctionSales)} />}
        <Tile label="Gifts recorded" value={gifts.length.toLocaleString()} />
        <Tile label="Gave in 2+ years" value={stats.repeat.toLocaleString()} />
      </div>

      <ThankYous rows={stats.thankYous} onChanged={load} onEmail={(list) => emailGroup(list, "Thank you for your gift")} />

      <Renewals
        rows={stats.renewals}
        eventNames={stats.eventNames}
        onChanged={load}
        onEmail={(list) => emailGroup(list, "North Texas Giving Day renewal")}
      />

      <section className="card overflow-hidden">
        <div className="p-4">
          <h2 className="font-display text-lg font-semibold">Giving by event</h2>
          {stats.auctionSales > 0 && (
            <p className="muted text-sm">
              Auction items count once in each total: at what they sold for, or at their market value if they haven&rsquo;t
              sold.
            </p>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th className="text-right">Donors</th>
                <th className="text-right">Gifts</th>
                {stats.auctionSales > 0 && <th className="text-right">Auction sales</th>}
                <th className="text-right">Total</th>
                <th>Most recent gift</th>
              </tr>
            </thead>
            <tbody>
              {stats.events.map((e) => (
                <tr key={e.name}>
                  <td>
                    <Link href={`/donors?event=${encodeURIComponent(e.name)}`} className="font-semibold text-teal-700">
                      {e.name}
                    </Link>
                  </td>
                  <td className="text-right">{e.donors}</td>
                  <td className="text-right">{e.gifts}</td>
                  {stats.auctionSales > 0 && <td className="text-right">{e.auction ? money(e.auction) : "—"}</td>}
                  <td className="text-right">{money(e.total)}</td>
                  <td>{e.latest ? shortDate(e.latest) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-4">
      <div className="label">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold text-teal-700">{value}</div>
    </div>
  );
}

function ChannelPills({ c }: { c: ContactSummary }) {
  return (
    <>
      {c.do_not_email && <span className="pill pill-bad ml-2">Do not email</span>}
      {c.do_not_call && <span className="pill pill-bad ml-2">Do not call</span>}
      {c.do_not_mail && <span className="pill pill-bad ml-2">Do not mail</span>}
    </>
  );
}

// ---------------------------------------------------------------------------
// Needs a thank-you: one row per gift, ticked off when thanked
// ---------------------------------------------------------------------------
function ThankYous({
  rows,
  onChanged,
  onEmail,
}: {
  rows: { gift: Gift; contact: ContactSummary }[];
  onChanged: () => Promise<void> | void;
  onEmail: (list: ContactSummary[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [method, setMethod] = useState<string>("Letter");
  const [on, setOn] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState<{ ids: string[]; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // forget ticks for gifts that have left the list
  useEffect(() => {
    setSelected((s) => new Set(Array.from(s).filter((id) => rows.some((r) => r.gift.id === id))));
  }, [rows]);

  const shown = showAll ? rows : rows.slice(0, 50);
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.gift.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function markThanked() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setBusy(true);
    setError(null);
    const { error } = await createClient().rpc("mark_gifts_thanked", {
      p_gift_ids: ids,
      p_method: method,
      p_on: on || todayLocal(),
      p_note: note,
    });
    setBusy(false);
    if (error) return setError(error.message);
    setDone({ ids, text: `Marked ${ids.length} gift${ids.length === 1 ? "" : "s"} as thanked (${method.toLowerCase()}, ${shortDate(on)}).` });
    setSelected(new Set());
    setNote("");
    await onChanged();
  }

  async function undo() {
    if (!done) return;
    setBusy(true);
    const { error } = await createClient().rpc("mark_gifts_thanked", { p_gift_ids: done.ids, p_method: null });
    setBusy(false);
    if (error) return setError(error.message);
    setDone(null);
    await onChanged();
  }

  const emailTargets = (selected.size ? rows.filter((r) => selected.has(r.gift.id)) : rows)
    .map((r) => r.contact)
    .filter((c) => c.email && !c.do_not_email);
  const uniqueTargets = Array.from(new Map(emailTargets.map((c) => [c.id, c])).values());

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 p-4">
        <div className="max-w-3xl">
          <h2 className="font-display text-lg font-semibold">
            Needs a thank-you {rows.length > 0 && <span className="pill pill-warn align-middle">{rows.length}</span>}
          </h2>
          <p className="muted text-sm">
            Gifts from the past 12 months that haven&rsquo;t been thanked. Tick the ones you&rsquo;ve thanked by letter, card
            or call, then click <strong>Mark thanked</strong>. A thank-you email sent from the CRM checks a gift off on its
            own. Each gift&rsquo;s thank-you is kept on the donor&rsquo;s page.
          </p>
        </div>
        {uniqueTargets.length > 0 && (
          <button className="btn btn-primary" onClick={() => onEmail(uniqueTargets)}>
            Email thank-yous ({uniqueTargets.length}{selected.size ? " selected" : ""})
          </button>
        )}
      </div>

      {done && (
        <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] bg-teal-50 px-4 py-2 text-sm">
          <span>{done.text}</span>
          <button className="font-semibold text-teal-700" disabled={busy} onClick={undo}>Undo</button>
          <button className="muted ml-auto text-xs" onClick={() => setDone(null)}>Dismiss</button>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex flex-wrap items-end gap-3 border-t border-[var(--border)] bg-[#faf8f3] p-4">
          <p className="pb-2 text-sm font-semibold">{selected.size} selected</p>
          <div>
            <label className="label" htmlFor="ty-method">Thanked by</label>
            <select id="ty-method" className="input mt-1 w-auto" value={method} onChange={(e) => setMethod(e.target.value)}>
              {THANK_METHODS.map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="ty-on">On</label>
            <input id="ty-on" type="date" className="input mt-1 w-auto" value={on} max={todayLocal()} onChange={(e) => setOn(e.target.value)} />
          </div>
          <div className="min-w-48 flex-1">
            <label className="label" htmlFor="ty-note">Note (optional)</label>
            <input id="ty-note" className="input mt-1" placeholder="e.g. handwritten card" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={markThanked}>
            {busy ? "Saving…" : `Mark ${selected.size} thanked`}
          </button>
          <button className="btn btn-secondary" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      {error && <p className="border-t border-[var(--border)] p-3 text-sm text-coral-600">{error}</p>}

      {rows.length === 0 ? (
        <p className="muted border-t border-[var(--border)] p-4 text-sm">
          Everyone is caught up. New gifts will appear here after you record or import them.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    checked={allShown}
                    aria-label="Select all shown"
                    onChange={() => {
                      const next = new Set(selected);
                      if (allShown) shown.forEach((r) => next.delete(r.gift.id));
                      else shown.forEach((r) => next.add(r.gift.id));
                      setSelected(next);
                    }}
                  />
                </th>
                <th>Donor</th>
                <th>Gift</th>
                <th>Email</th>
                <th>Phone</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ gift: g, contact: c }) => (
                <tr key={g.id} className={selected.has(g.id) ? "bg-teal-50" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(g.id)}
                      onChange={() => toggle(g.id)}
                      aria-label={`Thanked ${fullName(c)} for the ${money(g.amount)} gift`}
                    />
                  </td>
                  <td>
                    <Link href={`/donors/${c.id}`} className="font-semibold text-teal-700">{fullName(c)}</Link>
                    <ChannelPills c={c} />
                  </td>
                  <td>
                    {money(g.amount)} &middot; {shortDate(g.gift_date)}
                    <div className="muted text-xs">
                      {g.event_name}
                      {g.gift_type !== "Donation" && <> &middot; {g.gift_type}</>}
                    </div>
                  </td>
                  <td className="break-all">{c.email ?? "—"}</td>
                  <td className="whitespace-nowrap">{c.phone ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > shown.length && (
        <p className="border-t border-[var(--border)] p-3 text-sm">
          Showing the newest {shown.length} of {rows.length}.{" "}
          <button className="font-semibold text-teal-700" onClick={() => setShowAll(true)}>Show all</button>
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Renewal opportunities: lapsed donors, with a quick way to record a new gift
// ---------------------------------------------------------------------------
type QuickGift = { gift_date: string; amount: string; event_name: string; gift_type: GiftType; payment_method: string; notes: string };

function Renewals({
  rows,
  eventNames,
  onChanged,
  onEmail,
}: {
  rows: ContactSummary[];
  eventNames: string[];
  onChanged: () => Promise<void> | void;
  onEmail: (list: ContactSummary[]) => void;
}) {
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(25);
  const [openId, setOpenId] = useState<string | null>(null);
  const [form, setForm] = useState<QuickGift | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/\D/g, "");
    return rows.filter((c) => {
      const hay = [c.first_name, c.last_name, c.organization, c.email, ...c.alt_emails].join(" ").toLowerCase();
      const phoneHit = digits.length >= 4 && [c.phone, ...c.alt_phones].join(" ").replace(/\D/g, "").includes(digits);
      return hay.includes(q) || phoneHit;
    });
  }, [rows, search]);
  const shown = filtered.slice(0, limit);
  const emailable = rows.filter((c) => c.email && !c.do_not_email);

  function open(c: ContactSummary) {
    setOpenId(c.id);
    setError(null);
    setForm({ gift_date: todayLocal(), amount: "", event_name: "", gift_type: "Donation", payment_method: "", notes: "" });
  }

  async function save(c: ContactSummary) {
    if (!form) return;
    const amount = parseFloat(form.amount.replace(/[^0-9.]/g, ""));
    if (isNaN(amount) || amount <= 0) return setError("Enter the gift amount.");
    setBusy(true);
    setError(null);
    const { error } = await createClient().from("donations").insert({
      contact_id: c.id,
      gift_date: form.gift_date,
      amount,
      event_name: form.event_name.trim() || "General donation",
      gift_type: form.gift_type,
      payment_method: form.payment_method.trim() || null,
      notes: form.notes.trim() || null,
      source: "Entered by staff",
    });
    setBusy(false);
    if (error) return setError(error.message);
    setMessage(`Recorded ${money(amount)} from ${fullName(c)}. They've moved off this list, and the gift now appears under Needs a thank-you.`);
    setOpenId(null);
    setForm(null);
    await onChanged();
  }

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 p-4">
        <div className="max-w-3xl">
          <h2 className="font-display text-lg font-semibold">Renewal opportunities</h2>
          <p className="muted text-sm">
            Past donors who haven&rsquo;t given in the past 12 months, largest lifetime givers first. Click{" "}
            <strong>+ Record gift</strong> when one of them gives again. Donors without an email address are included so you
            can call or write to them.
          </p>
        </div>
        {emailable.length > 0 && (
          <button className="btn btn-primary" onClick={() => onEmail(emailable)}>
            Email renewal request ({emailable.length})
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-[var(--border)] px-4 py-3">
        <input
          className="input max-w-sm"
          placeholder="Find a donor by name, email or phone…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setLimit(25); }}
        />
        <span className="muted text-sm">{filtered.length} lapsed donor{filtered.length === 1 ? "" : "s"}</span>
      </div>
      {message && (
        <div className="flex items-center gap-3 border-t border-[var(--border)] bg-teal-50 px-4 py-2 text-sm">
          <span>{message}</span>
          <button className="muted ml-auto text-xs" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}
      <datalist id="renewal-events">
        {eventNames.map((e) => <option key={e} value={e} />)}
      </datalist>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Donor</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Last gift</th>
              <th className="text-right">Lifetime</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <Fragment key={c.id}>
                <tr>
                  <td>
                    <Link href={`/donors/${c.id}`} className="font-semibold text-teal-700">{fullName(c)}</Link>
                    <ChannelPills c={c} />
                  </td>
                  <td className="break-all">{c.email ?? "—"}</td>
                  <td className="whitespace-nowrap">{c.phone ?? "—"}</td>
                  <td>
                    {money(c.last_gift_amount)} &middot; {shortDate(c.last_gift_date)}
                    <div className="muted text-xs">{c.last_gift_event}</div>
                  </td>
                  <td className="text-right">{money(c.total_given)}</td>
                  <td className="whitespace-nowrap text-right">
                    {openId !== c.id && (
                      <button className="btn btn-secondary btn-sm" onClick={() => open(c)}>+ Record gift</button>
                    )}
                  </td>
                </tr>
                {openId === c.id && form && (
                  <tr>
                    <td colSpan={6} className="bg-[#faf8f3]">
                      <form
                        className="grid gap-3 md:grid-cols-6"
                        onSubmit={(e) => { e.preventDefault(); save(c); }}
                      >
                        <p className="text-sm font-semibold md:col-span-6">New gift from {fullName(c)}</p>
                        <div>
                          <label className="label">Date</label>
                          <input type="date" required className="input mt-1" value={form.gift_date}
                            onChange={(e) => setForm({ ...form, gift_date: e.target.value })} />
                        </div>
                        <div>
                          <label className="label">Amount ($)</label>
                          <input required inputMode="decimal" autoFocus className="input mt-1" value={form.amount}
                            onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                        </div>
                        <div className="md:col-span-2">
                          <label className="label">Event or campaign</label>
                          <input list="renewal-events" className="input mt-1" placeholder="e.g. NTX Giving Day 2026" value={form.event_name}
                            onChange={(e) => setForm({ ...form, event_name: e.target.value })} />
                        </div>
                        <div>
                          <label className="label">Type</label>
                          <select className="input mt-1" value={form.gift_type}
                            onChange={(e) => setForm({ ...form, gift_type: e.target.value as GiftType })}>
                            <option>Donation</option>
                            <option>Event ticket / registration</option>
                          </select>
                        </div>
                        <div>
                          <label className="label">Paid by</label>
                          <input list="renewal-pay" className="input mt-1" value={form.payment_method}
                            onChange={(e) => setForm({ ...form, payment_method: e.target.value })} />
                          <datalist id="renewal-pay">
                            {["Check", "Cash", "Credit Card", "PayPal", "Stock"].map((p) => <option key={p} value={p} />)}
                          </datalist>
                        </div>
                        <div className="md:col-span-6">
                          <label className="label">Notes</label>
                          <input className="input mt-1" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
                        </div>
                        <div className="flex flex-wrap items-center gap-2 md:col-span-6">
                          <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save gift"}</button>
                          <button type="button" className="btn btn-secondary" onClick={() => { setOpenId(null); setForm(null); }}>Cancel</button>
                          {error && <span className="text-sm text-coral-600">{error}</span>}
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="muted p-4 text-center">{search ? "No lapsed donor matches that search." : "No lapsed donors."}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {filtered.length > shown.length && (
        <p className="border-t border-[var(--border)] p-3 text-sm">
          Showing {shown.length} of {filtered.length}.{" "}
          <button className="font-semibold text-teal-700" onClick={() => setLimit(limit + 25)}>Show 25 more</button>
        </p>
      )}
    </section>
  );
}
