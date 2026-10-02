"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fetchAllContacts, setEmailRecipients } from "@/lib/data";
import { cityLine, downloadCsv, fullName, money, shortDate } from "@/lib/format";
import type { ContactSummary } from "@/lib/types";

type SortKey = "name" | "email" | "address" | "phone" | "total" | "last_gift";

export default function DonorsPage() {
  return (
    <Suspense fallback={<p className="muted">Loading…</p>}>
      <DonorList />
    </Suspense>
  );
}

function DonorList() {
  const router = useRouter();
  const params = useSearchParams();
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [event, setEvent] = useState(params.get("event") ?? "");
  const [year, setYear] = useState("");
  const [notSince, setNotSince] = useState("");
  const [emailOnly, setEmailOnly] = useState(false);
  const [kind, setKind] = useState<"" | "donors" | "attendees">("");
  const [sort, setSort] = useState<SortKey>("name");
  const [asc, setAsc] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchAllContacts(createClient())
      .then(setContacts)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const eventOptions = useMemo(
    () =>
      Array.from(
        new Set(
          contacts.flatMap((c) => [
            ...(c.events ? c.events.split("; ") : []),
            ...(c.events_attended ? c.events_attended.split("; ") : []),
          ])
        )
      ).sort(),
    [contacts]
  );
  const yearOptions = useMemo(
    () => Array.from(new Set(contacts.flatMap((c) => c.gift_years))).sort((a, b) => b - a),
    [contacts]
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = contacts.filter((c) => {
      if (q) {
        const hay = [
          c.first_name,
          c.last_name,
          c.organization,
          c.email,
          ...c.alt_emails,
          c.phone,
          ...c.alt_phones,
          c.address,
          c.city,
          c.zip,
          c.notes,
        ]
          .join(" ")
          .toLowerCase();
        const digits = q.replace(/\D/g, "");
        const phoneHit = digits.length >= 4 && [c.phone, ...c.alt_phones].join(" ").replace(/\D/g, "").includes(digits);
        if (!hay.includes(q) && !phoneHit) return false;
      }
      if (
        event &&
        !(c.events ?? "").split("; ").includes(event) &&
        !(c.events_attended ?? "").split("; ").includes(event)
      )
        return false;
      if (kind === "donors" && c.gift_count === 0) return false;
      if (kind === "attendees" && c.gift_count > 0) return false;
      if (year && !c.gift_years.includes(Number(year))) return false;
      if (notSince && c.gift_years.some((y) => y >= Number(notSince))) return false;
      if (emailOnly && (!c.email || c.do_not_email || c.is_anonymous)) return false;
      return true;
    });

    const val = (c: ContactSummary): string | number => {
      switch (sort) {
        case "name":
          return `${c.last_name} ${c.first_name}`.toLowerCase();
        case "email":
          return (c.email ?? "~").toLowerCase();
        case "address":
          return `${c.city ?? "~"} ${c.address ?? ""}`.toLowerCase();
        case "phone":
          return (c.phone ?? "~").replace(/\D/g, "") || "~";
        case "total":
          return Number(c.total_given);
        case "last_gift":
          return c.last_gift_date ?? "";
      }
    };
    rows.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = typeof va === "number" ? va - (vb as number) : String(va).localeCompare(String(vb));
      return asc ? cmp : -cmp;
    });
    return rows;
  }, [contacts, search, event, year, notSince, emailOnly, kind, sort, asc]);

  function toggleSort(k: SortKey) {
    if (sort === k) setAsc(!asc);
    else {
      setSort(k);
      setAsc(k === "total" || k === "last_gift" ? false : true);
    }
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  const allShownSelected = shown.length > 0 && shown.every((c) => selected.has(c.id));
  function toggleAllShown() {
    const next = new Set(selected);
    if (allShownSelected) shown.forEach((c) => next.delete(c.id));
    else shown.forEach((c) => next.add(c.id));
    setSelected(next);
  }

  function emailSelected() {
    setEmailRecipients(Array.from(selected));
    router.push("/email");
  }

  function exportShown() {
    const rows = selected.size ? shown.filter((c) => selected.has(c.id)) : shown;
    downloadCsv(
      `DHA donors ${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "First Name", "Last Name", "Organization", "Email", "Other Emails", "Phone", "Other Phones", "Address", "City",
        "State", "Zip", "Total Given", "Number of Gifts", "First Gift", "Last Gift", "Last Gift Amount",
        "Last Gift Event", "All Events", "Years Given", "Events Attended", "Do Not Email", "Notes",
      ],
      rows.map((c) => [
        c.first_name, c.last_name, c.organization, c.email, c.alt_emails.join("; "), c.phone, c.alt_phones.join("; "),
        c.address, c.city, c.state, c.zip, Number(c.total_given).toFixed(2), c.gift_count, c.first_gift_date,
        c.last_gift_date, c.last_gift_amount === null ? "" : Number(c.last_gift_amount).toFixed(2),
        c.last_gift_event, c.events, [...c.gift_years].sort().join(", "), c.events_attended,
        c.do_not_email ? "Yes" : "",
        c.notes,
      ])
    );
  }

  const Th = ({ k, children, right }: { k: SortKey; children: React.ReactNode; right?: boolean }) => (
    <th className={right ? "text-right" : ""}>
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 uppercase">
        {children}
        <span className="text-[10px]">{sort === k ? (asc ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="text-coral-600">{error}</p>;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">Donors</h1>
          <p className="muted text-sm">
            {shown.length} of {contacts.length} contacts shown. Click a column heading to sort.
          </p>
        </div>
        <Link href="/donors/new" className="btn btn-primary">
          + Add donor
        </Link>
      </div>

      <div className="card grid gap-3 p-4 md:grid-cols-7">
        <div className="md:col-span-2">
          <label className="label">Search</label>
          <input
            className="input mt-1"
            placeholder="Name, email, phone, address…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Event (gave or attended)</label>
          <select className="input mt-1" value={event} onChange={(e) => setEvent(e.target.value)}>
            <option value="">All events</option>
            {eventOptions.map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Gave in year</label>
          <select className="input mt-1" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">Any year</option>
            {yearOptions.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">No gift since</label>
          <select className="input mt-1" value={notSince} onChange={(e) => setNotSince(e.target.value)}>
            <option value="">—</option>
            {yearOptions.map((y) => (
              <option key={y} value={y}>
                Not in {y} or later
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Show</label>
          <select className="input mt-1" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="">Everyone</option>
            <option value="donors">Donors (gave at least once)</option>
            <option value="attendees">Attended only, no gifts yet</option>
          </select>
        </div>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" checked={emailOnly} onChange={(e) => setEmailOnly(e.target.checked)} />
          Only donors we can email
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button className="btn btn-primary" disabled={!selected.size} onClick={emailSelected}>
          Email selected ({selected.size})
        </button>
        <button className="btn btn-secondary" onClick={exportShown}>
          Download {selected.size ? "selected" : "shown"} for Excel
        </button>
        {selected.size > 0 && (
          <button className="btn btn-secondary" onClick={() => setSelected(new Set())}>
            Clear selection
          </button>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Select all shown" />
              </th>
              <Th k="name">Name</Th>
              <Th k="email">Email</Th>
              <Th k="phone">Phone</Th>
              <Th k="address">Address</Th>
              <Th k="total" right>
                Total given
              </Th>
              <Th k="last_gift">Last gift</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((c) => (
              <tr key={c.id}>
                <td>
                  <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select ${fullName(c)}`} />
                </td>
                <td>
                  <Link href={`/donors/${c.id}`} className="font-semibold text-teal-700">
                    {c.last_name || c.first_name ? `${c.last_name}${c.last_name && c.first_name ? ", " : ""}${c.first_name}` : "(no name)"}
                  </Link>
                  {c.do_not_email && <span className="pill pill-bad ml-2">Do not email</span>}
                  {c.organization && c.organization !== c.last_name && (
                    <div className="muted text-xs">{c.organization}</div>
                  )}
                </td>
                <td className="break-all">
                  {c.email ?? <span className="muted">—</span>}
                  {c.alt_emails.length > 0 && <div className="muted text-xs">+{c.alt_emails.length} other</div>}
                </td>
                <td className="whitespace-nowrap">{c.phone ?? <span className="muted">—</span>}</td>
                <td>
                  {c.address ?? <span className="muted">—</span>}
                  <div className="muted text-xs">{cityLine(c)}</div>
                </td>
                <td className="text-right">
                  {money(c.total_given)}
                  <div className="muted text-xs">
                    {c.gift_count} gift{c.gift_count === 1 ? "" : "s"}
                  </div>
                </td>
                <td>
                  {c.last_gift_date ? (
                    <>
                      {money(c.last_gift_amount)} <span className="muted">on</span> {shortDate(c.last_gift_date)}
                      <div className="muted text-xs">{c.last_gift_event}</div>
                    </>
                  ) : (
                    <span className="muted text-xs">
                      {c.events_attended ? `No gifts yet · attended ${c.events_attended}` : "No gifts yet"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
            {shown.length === 0 && (
              <tr>
                <td colSpan={7} className="muted p-6 text-center">
                  No donors match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
