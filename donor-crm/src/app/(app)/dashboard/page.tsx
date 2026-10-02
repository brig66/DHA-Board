"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllContacts, fetchAllDonations, setEmailRecipients } from "@/lib/data";
import { fullName, money, shortDate } from "@/lib/format";
import type { ContactSummary } from "@/lib/types";

type Gift = { id: string; contact_id: string; gift_date: string; amount: number; event_name: string };

export default function DashboardPage() {
  const router = useRouter();
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    Promise.all([fetchAllContacts(supabase), fetchAllDonations(supabase)])
      .then(([c, g]) => {
        setContacts(c);
        setGifts(g);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const stats = useMemo(() => {
    const named = contacts.filter((c) => !c.is_anonymous);
    const total = gifts.reduce((s, g) => s + Number(g.amount), 0);

    const byEvent = new Map<string, { donors: Set<string>; gifts: number; total: number; latest: string }>();
    for (const g of gifts) {
      const e = byEvent.get(g.event_name) ?? { donors: new Set(), gifts: 0, total: 0, latest: "" };
      e.donors.add(g.contact_id);
      e.gifts += 1;
      e.total += Number(g.amount);
      if (g.gift_date > e.latest) e.latest = g.gift_date;
      byEvent.set(g.event_name, e);
    }
    const events = Array.from(byEvent.entries())
      .map(([name, e]) => ({ name, donors: e.donors.size, gifts: e.gifts, total: e.total, latest: e.latest }))
      .sort((a, b) => b.latest.localeCompare(a.latest));

    const yearAgo = new Date();
    yearAgo.setFullYear(yearAgo.getFullYear() - 1);
    const cutoff = yearAgo.toISOString().slice(0, 10);

    // gave before, nothing in the past 12 months, and we have an email for them
    const renewals = named
      .filter((c) => c.last_gift_date && c.last_gift_date < cutoff && c.email && !c.do_not_email)
      .sort((a, b) => Number(b.total_given) - Number(a.total_given));

    // a gift in the past 12 months that is newer than our last email to them
    const thankYous = named
      .filter(
        (c) =>
          c.last_gift_date &&
          c.last_gift_date >= cutoff &&
          (!c.last_emailed_at || c.last_emailed_at.slice(0, 10) < c.last_gift_date)
      )
      .sort((a, b) => (b.last_gift_date ?? "").localeCompare(a.last_gift_date ?? ""));

    const repeat = named.filter((c) => c.gift_years.length > 1).length;

    return { named, total, events, renewals, thankYous, repeat };
  }, [contacts, gifts]);

  function emailGroup(list: ContactSummary[], template: string) {
    setEmailRecipients(list.map((c) => c.id));
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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Tile label="Donors" value={stats.named.length.toLocaleString()} />
        <Tile label="Total raised" value={money(stats.total)} />
        <Tile label="Gifts recorded" value={gifts.length.toLocaleString()} />
        <Tile label="Gave in 2+ years" value={stats.repeat.toLocaleString()} />
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Needs a thank-you</h2>
            <p className="muted text-sm">Donors who gave in the past 12 months and haven&rsquo;t been emailed since.</p>
          </div>
          {stats.thankYous.length > 0 && (
            <button className="btn btn-primary" onClick={() => emailGroup(stats.thankYous, "Thank you for your gift")}>
              Email thank-yous ({stats.thankYous.length})
            </button>
          )}
        </div>
        {stats.thankYous.length === 0 ? (
          <p className="muted border-t border-[var(--border)] p-4 text-sm">
            Everyone is caught up. New gifts will appear here after you import them.
          </p>
        ) : (
          <DonorMiniTable rows={stats.thankYous.slice(0, 15)} />
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Renewal opportunities</h2>
            <p className="muted text-sm">
              Past donors with an email address who haven&rsquo;t given in the past 12 months, largest lifetime
              givers first.
            </p>
          </div>
          {stats.renewals.length > 0 && (
            <button
              className="btn btn-primary"
              onClick={() => emailGroup(stats.renewals, "North Texas Giving Day renewal")}
            >
              Email renewal request ({stats.renewals.length})
            </button>
          )}
        </div>
        <DonorMiniTable rows={stats.renewals.slice(0, 15)} />
        {stats.renewals.length > 15 && (
          <p className="muted border-t border-[var(--border)] p-3 text-sm">
            Showing the top 15 of {stats.renewals.length}. <Link href="/donors" className="font-semibold text-teal-700">See all donors</Link>
          </p>
        )}
      </section>

      <section className="card overflow-hidden">
        <h2 className="p-4 font-display text-lg font-semibold">Giving by event</h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Event</th>
                <th className="text-right">Donors</th>
                <th className="text-right">Gifts</th>
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
                  <td className="text-right">{money(e.total)}</td>
                  <td>{shortDate(e.latest)}</td>
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

function DonorMiniTable({ rows }: { rows: ContactSummary[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>Donor</th>
            <th>Email</th>
            <th>Last gift</th>
            <th className="text-right">Lifetime</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id}>
              <td>
                <Link href={`/donors/${c.id}`} className="font-semibold text-teal-700">
                  {fullName(c)}
                </Link>
              </td>
              <td>{c.email ?? "—"}</td>
              <td>
                {money(c.last_gift_amount)} &middot; {shortDate(c.last_gift_date)}
                <div className="muted text-xs">{c.last_gift_event}</div>
              </td>
              <td className="text-right">{money(c.total_given)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
