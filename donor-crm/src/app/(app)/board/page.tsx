"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setEmailRecipients } from "@/lib/data";
import { downloadCsv, fullName, money, shortDate } from "@/lib/format";
import type { ContactSummary, Donation } from "@/lib/types";

type Gift = Pick<Donation, "id" | "contact_id" | "gift_date" | "amount" | "event_name" | "gift_type" | "payment_method">;

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

export default function BoardPage() {
  const router = useRouter();
  const [members, setMembers] = useState<ContactSummary[]>([]);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [giftYear, setGiftYear] = useState("");

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const m = await supabase.from("contact_summary").select("*").eq("is_board_member", true);
      if (m.error) {
        setError(m.error.message);
        setLoading(false);
        return;
      }
      const list = (m.data ?? []) as ContactSummary[];
      setMembers(list);
      if (list.length) {
        const g = await supabase
          .from("donations")
          .select("id, contact_id, gift_date, amount, event_name, gift_type, payment_method")
          .in("contact_id", list.map((c) => c.id))
          .order("gift_date", { ascending: false })
          .limit(10000);
        if (g.error) setError(g.error.message);
        setGifts((g.data ?? []) as Gift[]);
      }
      setLoading(false);
    })();
  }, []);

  const thisYear = new Date().getFullYear();

  const stats = useMemo(() => {
    const sorted = [...members].sort((a, b) =>
      `${a.last_name} ${a.first_name}`.toLowerCase().localeCompare(`${b.last_name} ${b.first_name}`.toLowerCase())
    );
    // amount given by each member in each year
    const byMemberYear = new Map<string, Map<number, number>>();
    for (const g of gifts) {
      const y = Number(g.gift_date.slice(0, 4));
      const m = byMemberYear.get(g.contact_id) ?? new Map<number, number>();
      m.set(y, (m.get(y) ?? 0) + Number(g.amount));
      byMemberYear.set(g.contact_id, m);
    }
    const firstYear = gifts.length ? Math.min(...gifts.map((g) => Number(g.gift_date.slice(0, 4)))) : thisYear;
    const years: number[] = [];
    for (let y = thisYear; y >= firstYear; y--) years.push(y);

    const byYear = years.map((y) => {
      const givers = sorted.filter((c) => byMemberYear.get(c.id)?.has(y));
      const total = givers.reduce((s, c) => s + (byMemberYear.get(c.id)?.get(y) ?? 0), 0);
      return { year: y, givers: givers.length, total, notGiven: sorted.filter((c) => !byMemberYear.get(c.id)?.has(y)) };
    });
    const lifetime = gifts.reduce((s, g) => s + Number(g.amount), 0);
    return { sorted, byMemberYear, years, byYear, lifetime };
  }, [members, gifts, thisYear]);

  const current = stats.byYear[0];
  const board = members.length;
  const shownGifts = giftYear ? gifts.filter((g) => g.gift_date.startsWith(giftYear)) : gifts;
  const nameOf = useMemo(() => new Map(members.map((c) => [c.id, fullName(c)])), [members]);

  function emailBoard(list: ContactSummary[]) {
    setEmailRecipients(list.map((c) => c.id));
    router.push("/email");
  }

  function exportBoard() {
    downloadCsv(
      `DHA board giving ${new Date().toISOString().slice(0, 10)}.csv`,
      ["Board Member", "Email", "Phone", ...stats.years.map(String), "Lifetime Total"],
      [
        ...stats.sorted.map((c) => [
          fullName(c),
          c.email,
          c.phone,
          ...stats.years.map((y) => {
            const v = stats.byMemberYear.get(c.id)?.get(y);
            return v === undefined ? "" : v.toFixed(2);
          }),
          Number(c.total_given).toFixed(2),
        ]),
        [],
        ["% of board who gave", "", "", ...stats.byYear.map((r) => `${pct(r.givers, board)}%`), ""],
        ["Board total", "", "", ...stats.byYear.map((r) => r.total.toFixed(2)), stats.lifetime.toFixed(2)],
      ]
    );
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="text-coral-600">{error}</p>;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Board of Directors</h1>
          <p className="muted text-sm">
            Giving by current board members. Every kind of gift counts: donations, event tickets and in-kind gifts.
          </p>
        </div>
        {board > 0 && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => emailBoard(stats.sorted)}>
              Email the board
            </button>
            <button className="btn btn-secondary" onClick={exportBoard}>
              Download for Excel
            </button>
          </div>
        )}
      </div>

      {board === 0 ? (
        <section className="card p-6 text-sm">
          No board members are marked yet. Open a donor&rsquo;s page, click <strong>Edit details</strong>, and check{" "}
          <strong>Current board member</strong>.
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Tile label="Board members" value={String(board)} />
            <Tile label={`Gave in ${thisYear}`} value={`${current.givers} of ${board} (${pct(current.givers, board)}%)`} />
            <Tile label={`Board giving in ${thisYear}`} value={money(current.total)} />
            <Tile label="Lifetime board giving" value={money(stats.lifetime)} />
          </div>

          <section className="card overflow-hidden">
            <div className="p-4">
              <h2 className="font-display text-lg font-semibold">Board participation by year</h2>
              <p className="muted text-sm">
                Percent of the {board} current board members who made a gift of any kind in each year.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th className="text-right">Members who gave</th>
                    <th>% of board</th>
                    <th className="text-right">Total given</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byYear.map((r) => (
                    <tr key={r.year}>
                      <td className="font-semibold">{r.year}</td>
                      <td className="text-right">
                        {r.givers} of {board}
                      </td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-40 overflow-hidden rounded-full bg-[#ece7dc]">
                            <div className="h-full bg-teal-700" style={{ width: `${pct(r.givers, board)}%` }} />
                          </div>
                          <span className="font-semibold">{pct(r.givers, board)}%</span>
                        </div>
                      </td>
                      <td className="text-right">{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {current.notGiven.length > 0 && (
            <section className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-display text-lg font-semibold">No gift yet in {thisYear}</h2>
                  <p className="muted text-sm">
                    {current.notGiven.length} board member{current.notGiven.length === 1 ? "" : "s"} still to reach 100%
                    participation.
                  </p>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={() => emailBoard(current.notGiven)}>
                  Email these members
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {current.notGiven.map((c) => (
                  <Link key={c.id} href={`/donors/${c.id}`} className="pill pill-warn">
                    {fullName(c)}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card overflow-hidden">
            <div className="p-4">
              <h2 className="font-display text-lg font-semibold">Giving by member and year</h2>
              <p className="muted text-sm">Amount each board member gave in each year. Scroll right for earlier years.</p>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-white">Board member</th>
                    {stats.years.map((y) => (
                      <th key={y} className="text-right">
                        {y}
                      </th>
                    ))}
                    <th className="text-right">Lifetime</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sorted.map((c) => (
                    <tr key={c.id}>
                      <td className="sticky left-0 whitespace-nowrap bg-white">
                        <Link href={`/donors/${c.id}`} className="font-semibold text-teal-700">
                          {fullName(c)}
                        </Link>
                      </td>
                      {stats.years.map((y) => {
                        const v = stats.byMemberYear.get(c.id)?.get(y);
                        return (
                          <td key={y} className="whitespace-nowrap text-right">
                            {v === undefined ? <span className="muted">—</span> : money(v)}
                          </td>
                        );
                      })}
                      <td className="whitespace-nowrap text-right font-semibold">{money(c.total_given)}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#faf8f3]">
                    <td className="sticky left-0 bg-[#faf8f3] font-semibold">% of board who gave</td>
                    {stats.byYear.map((r) => (
                      <td key={r.year} className="text-right font-semibold">
                        {pct(r.givers, board)}%
                      </td>
                    ))}
                    <td />
                  </tr>
                  <tr className="bg-[#faf8f3]">
                    <td className="sticky left-0 bg-[#faf8f3] font-semibold">Board total</td>
                    {stats.byYear.map((r) => (
                      <td key={r.year} className="whitespace-nowrap text-right font-semibold">
                        {money(r.total)}
                      </td>
                    ))}
                    <td className="whitespace-nowrap text-right font-semibold">{money(stats.lifetime)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 p-4">
              <h2 className="font-display text-lg font-semibold">Board members&rsquo; gifts</h2>
              <select className="input w-auto" value={giftYear} onChange={(e) => setGiftYear(e.target.value)}>
                <option value="">All years</option>
                {stats.years.map((y) => (
                  <option key={y}>{y}</option>
                ))}
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Board member</th>
                    <th className="text-right">Amount</th>
                    <th>Event</th>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {shownGifts.map((g) => (
                    <Fragment key={g.id}>
                      <tr>
                        <td className="whitespace-nowrap">{shortDate(g.gift_date)}</td>
                        <td>
                          <Link href={`/donors/${g.contact_id}`} className="font-semibold text-teal-700">
                            {nameOf.get(g.contact_id)}
                          </Link>
                        </td>
                        <td className="text-right">{money(g.amount)}</td>
                        <td>{g.event_name}</td>
                        <td>
                          {g.gift_type && g.gift_type !== "Donation" ? (
                            <span className="pill pill-warn">{g.gift_type}</span>
                          ) : (
                            <span className="muted text-xs">{g.payment_method ?? "Donation"}</span>
                          )}
                        </td>
                      </tr>
                    </Fragment>
                  ))}
                  {shownGifts.length === 0 && (
                    <tr>
                      <td colSpan={5} className="muted p-4 text-center">
                        No gifts from board members{giftYear ? ` in ${giftYear}` : ""}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <p className="muted text-xs">
            To add or remove a board member, open their donor page, click Edit details, and check or uncheck
            &ldquo;Current board member.&rdquo;
          </p>
        </>
      )}
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
