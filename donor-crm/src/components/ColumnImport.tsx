"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { money, shortDate } from "@/lib/format";
import { todayLocal } from "@/lib/thanks";
import {
  FIELDS,
  buildAuction,
  buildPeople,
  buildVolunteers,
  guessColumns,
  headersOf,
  type AuctionRow,
  type ColumnMap,
  type Defaults,
  type ImportKind,
  type PeopleRow,
  type RawRow,
  type VolunteerRow,
} from "@/lib/importColumns";
import { SALE_TYPES } from "@/lib/types";

type Summary = Record<string, number>;

const SUMMARY_LINES: Record<ImportKind, { key: string; text: string }[]> = {
  volunteers: [
    { key: "new_people", text: "new people added" },
    { key: "matched_people", text: "matched to people already in the CRM" },
    { key: "marked_volunteer", text: "newly marked as volunteers" },
    { key: "hours_added", text: "volunteer hour entries logged" },
    { key: "hours_already_recorded", text: "hour entries skipped because they were already logged" },
  ],
  people: [
    { key: "new_people", text: "new people added" },
    { key: "matched_people", text: "matched to people already in the CRM" },
    { key: "boxes_ticked", text: "boxes ticked (board member, volunteer, do not email, call or mail)" },
  ],
  auction: [
    { key: "items_added", text: "items added" },
    { key: "items_updated", text: "items updated (already imported from this event)" },
    { key: "new_people", text: "new donors or buyers added" },
    { key: "matched_people", text: "donors or buyers matched to people already in the CRM" },
  ],
};

const RPC: Record<ImportKind, string> = { volunteers: "import_volunteers", people: "import_people", auction: "import_auction_items" };

const name = (p: { first_name: string; last_name: string } | null) =>
  p ? [p.first_name, p.last_name].filter(Boolean).join(" ") : "";

export default function ColumnImport({
  kind,
  fileName,
  raw,
  initialEvent,
  knownEvents,
}: {
  kind: ImportKind;
  fileName: string;
  raw: RawRow[];
  initialEvent: string;
  knownEvents: string[];
}) {
  const headers = useMemo(() => headersOf(raw), [raw]);
  const [map, setMap] = useState<ColumnMap>(() => guessColumns(kind, headers));
  const [defaults, setDefaults] = useState<Defaults>({});
  const [event, setEvent] = useState(initialEvent);
  const [label, setLabel] = useState(fileName.replace(/\.[^.]+$/, ""));
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const built = useMemo(() => {
    if (kind === "volunteers") return buildVolunteers(raw, map, defaults);
    if (kind === "people") return buildPeople(raw, map, defaults);
    return buildAuction(raw, map, defaults);
  }, [kind, raw, map, defaults]);

  const defs = FIELDS[kind];
  const used = defs.filter((d) => map[d.field]);
  const sample = (h: string) => {
    for (const r of raw.slice(0, 20)) {
      const v = r[h];
      if (v !== null && v !== undefined && String(v).trim()) return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim();
    }
    return "";
  };

  const problem =
    kind === "auction" && !map.title
      ? "Choose which column has the item name."
      : kind !== "auction" && !map.first_name && !map.last_name && !map.full_name && !map.email
        ? "Choose which column has each person's name or email."
        : kind === "auction" && !event.trim()
          ? "Enter the event these items were for."
          : null;

  async function run() {
    if (problem || !built.rows.length) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const supabase = createClient();
    const total: Summary = {};
    try {
      for (let i = 0; i < built.rows.length; i += 200) {
        const args: Record<string, unknown> = { rows: built.rows.slice(i, i + 200), source_label: label.trim() || fileName };
        if (kind === "auction") args.event = event.trim();
        const { data, error } = await supabase.rpc(RPC[kind], args);
        if (error) throw error;
        for (const [k, v] of Object.entries((data ?? {}) as Summary)) total[k] = (total[k] ?? 0) + (Number(v) || 0);
        setProgress(Math.min(built.rows.length, i + 200));
      }
      setSummary(total);
    } catch (e) {
      setError(`Import stopped: ${(e as Error).message}. Rows imported before the error are saved; running the same file again is safe.`);
    }
    setBusy(false);
  }

  if (summary)
    return (
      <section className="card p-5">
        <h2 className="font-display text-lg font-semibold">Import complete</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {SUMMARY_LINES[kind].map((l) =>
            (summary[l.key] ?? 0) > 0 || l.key.startsWith("new") || l.key.startsWith("items_added") ? (
              <li key={l.key}><strong>{summary[l.key] ?? 0}</strong> {l.text}</li>
            ) : null
          )}
          <li>
            <strong>{summary.possible_duplicates_flagged ?? 0}</strong> possible duplicates flagged for review
            {(summary.possible_duplicates_flagged ?? 0) > 0 && (
              <> — <Link href="/duplicates" className="font-semibold text-teal-700">review them now</Link></>
            )}
          </li>
        </ul>
        <p className="mt-3 text-sm">
          {kind === "auction" ? (
            <Link href="/in-kind" className="font-semibold text-teal-700">Open the In-Kind tab</Link>
          ) : kind === "volunteers" ? (
            <Link href="/donors?show=volunteers" className="font-semibold text-teal-700">See volunteers on the Donors tab</Link>
          ) : (
            <Link href="/donors" className="font-semibold text-teal-700">Open the Donors tab</Link>
          )}
        </p>
      </section>
    );

  const groups = Array.from(new Set(defs.map((d) => d.group ?? "")));
  const groupTitle: Record<string, string> = { "": kind === "auction" ? "Item" : "Person", donor_: "Who donated it", buyer_: "Who bought it" };
  const auctionMain = (d: (typeof defs)[number]) => !d.group && ["bidder_number", "sold_amount", "sold_date"].includes(d.field);

  return (
    <section className="card flex flex-col gap-5 p-5">
      <div>
        <h2 className="font-display text-lg font-semibold">Match the columns</h2>
        <p className="muted text-sm">
          The CRM guessed which column in <strong>{fileName}</strong> holds each piece of information. Check the guesses
          (the example from your file is shown on the right) and change any that are wrong. Leave a field on{" "}
          <em>Not in this file</em> if the file doesn&rsquo;t have it.
        </p>
      </div>

      {kind === "auction" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Event these items were for</label>
            <input list="column-import-events" className="input mt-1" placeholder="e.g. Love That Smile 2026" value={event}
              onChange={(e) => setEvent(e.target.value)} />
            <datalist id="column-import-events">{knownEvents.map((e) => <option key={e} value={e} />)}</datalist>
          </div>
          <div>
            <label className="label">Type for items the file doesn&rsquo;t label</label>
            <select className="input mt-1" value={defaults.sale_type ?? ""} onChange={(e) => setDefaults({ ...defaults, sale_type: e.target.value })}>
              <option value="">Leave blank</option>
              {SALE_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
      )}

      {groups.map((g) => (
        <div key={g}>
          {groups.length > 1 && <h3 className="mb-2 text-sm font-semibold">{groupTitle[g] ?? g}</h3>}
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {defs
              .filter((d) => (d.group ?? "") === g && !(g === "" && kind === "auction" && auctionMain(d)))
              .map((d) => <FieldRow key={d.field} label={d.label} value={map[d.field]} headers={headers} sample={sample}
                onChange={(h) => setMap({ ...map, [d.field]: h })} />)}
            {g === "buyer_" &&
              defs.filter(auctionMain).map((d) => <FieldRow key={d.field} label={d.label} value={map[d.field]} headers={headers} sample={sample}
                onChange={(h) => setMap({ ...map, [d.field]: h })} />)}
          </div>
        </div>
      ))}

      {kind === "volunteers" && (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">Date to use when a row has hours but no date</label>
            <input type="date" className="input mt-1" max={todayLocal()} value={defaults.work_date ?? ""}
              onChange={(e) => setDefaults({ ...defaults, work_date: e.target.value })} />
          </div>
          <div>
            <label className="label">What they did, when the row doesn&rsquo;t say</label>
            <input className="input mt-1" placeholder="e.g. Love That Smile 2026 setup" value={defaults.activity ?? ""}
              onChange={(e) => setDefaults({ ...defaults, activity: e.target.value })} />
          </div>
        </div>
      )}
      {kind === "people" && (
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!defaults.everyone_board} onChange={(e) => setDefaults({ ...defaults, everyone_board: e.target.checked })} />
            Mark everyone in this file as a board member
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={!!defaults.everyone_volunteer} onChange={(e) => setDefaults({ ...defaults, everyone_volunteer: e.target.checked })} />
            Mark everyone in this file as a volunteer
          </label>
        </div>
      )}

      <div>
        <h3 className="text-sm font-semibold">Preview</h3>
        <p className="mt-1 text-sm">
          <strong>{built.rows.length}</strong> {kind === "auction" ? "items" : "people"} ready to import.
          {built.skipped.length > 0 && (
            <span className="text-[#b8862e]">
              {" "}{built.skipped.length} row{built.skipped.length === 1 ? "" : "s"} left out:{" "}
              {built.skipped.slice(0, 6).map((s) => `row ${s.line} (${s.reason.toLowerCase()})`).join(", ")}
              {built.skipped.length > 6 && "…"}
            </span>
          )}
        </p>
        {built.notes.map((n) => <p key={n} className="mt-1 text-sm text-[#b8862e]">{n}</p>)}
        {kind === "people" && map.do_not_email && (
          <p className="muted mt-1 text-xs">
            People marked &ldquo;do not email&rdquo; here are opted out and won&rsquo;t get CRM emails. Blank or &ldquo;No&rdquo; leaves
            their current setting alone; an import never opts anyone back in.
          </p>
        )}
        <div className="mt-2 overflow-x-auto rounded-lg border border-[var(--border)]">
          <Preview kind={kind} rows={showAll ? built.rows : built.rows.slice(0, 10)} />
        </div>
        {built.rows.length > 10 && (
          <button className="mt-1 text-xs font-semibold text-teal-700" onClick={() => setShowAll(!showAll)}>
            {showAll ? "Show the first 10" : `Showing the first 10 of ${built.rows.length}. Show all`}
          </button>
        )}
        {used.length === 0 && <p className="text-sm text-coral-600">No columns are matched yet.</p>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <label className="label">Label for this import (shown on what it adds)</label>
          <input className="input mt-1" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={busy || !!problem || !built.rows.length} onClick={run}>
          {busy ? `Importing… ${progress}/${built.rows.length}` : `Import ${built.rows.length} ${kind === "auction" ? "items" : "people"}`}
        </button>
      </div>
      {problem && <p className="text-sm text-coral-600">{problem}</p>}
      {error && <p className="text-sm text-coral-600">{error}</p>}
    </section>
  );
}

function FieldRow({
  label,
  value,
  headers,
  sample,
  onChange,
}: {
  label: string;
  value: string;
  headers: string[];
  sample: (h: string) => string;
  onChange: (h: string) => void;
}) {
  const ex = value ? sample(value) : "";
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-2 text-sm">
      <span className="pt-1.5 font-semibold">{label}</span>
      <div className="min-w-0">
        <select className={`input py-1 ${value ? "" : "text-[var(--muted)]"}`} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Not in this file</option>
          {headers.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        {ex && <div className="muted mt-0.5 truncate text-xs" title={ex}>e.g. {ex}</div>}
      </div>
    </div>
  );
}

function Preview({ kind, rows }: { kind: ImportKind; rows: (VolunteerRow | PeopleRow | AuctionRow)[] }) {
  if (kind === "auction") {
    const rs = rows as AuctionRow[];
    return (
      <table className="table">
        <thead>
          <tr><th>Item</th><th>Type</th><th>Donor</th><th className="text-right">Value</th><th>Buyer</th><th className="text-right">Sold for</th></tr>
        </thead>
        <tbody>
          {rs.map((r, i) => (
            <tr key={i}>
              <td>{r.item_number ? `#${r.item_number} ` : ""}{r.title}{r.description && <div className="muted text-xs">{r.description}</div>}</td>
              <td>{r.sale_type ?? "—"}</td>
              <td>{r.donor ? <>{name(r.donor)}{r.donor.organization && r.donor.organization !== r.donor.last_name && <div className="muted text-xs">{r.donor.organization}</div>}</> : "—"}</td>
              <td className="text-right">{r.fair_market_value === null ? "—" : money(r.fair_market_value)}</td>
              <td>{r.buyer ? name(r.buyer) : r.bidder_number ? `Bidder ${r.bidder_number}` : "—"}</td>
              <td className="text-right">{r.sold_amount === null ? "—" : money(r.sold_amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (kind === "volunteers") {
    const rs = rows as VolunteerRow[];
    return (
      <table className="table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Date</th><th className="text-right">Hours</th><th>What they did</th></tr></thead>
        <tbody>
          {rs.map((r, i) => (
            <tr key={i}>
              <td>{name(r) || "—"}</td>
              <td>{r.email ?? "—"}</td>
              <td className="whitespace-nowrap">{r.phone ?? "—"}</td>
              <td className="whitespace-nowrap">{r.work_date ? shortDate(r.work_date) : "—"}</td>
              <td className="text-right">{r.hours ?? "—"}</td>
              <td>{r.activity ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const rs = rows as PeopleRow[];
  return (
    <table className="table">
      <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Marked as</th></tr></thead>
      <tbody>
        {rs.map((r, i) => (
          <tr key={i}>
            <td>{name(r) || "—"}{r.organization && r.organization !== r.last_name && <div className="muted text-xs">{r.organization}</div>}</td>
            <td>{r.email ?? "—"}</td>
            <td className="whitespace-nowrap">{r.phone ?? "—"}</td>
            <td>{[r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}</td>
            <td className="text-xs">
              {[r.is_board_member && "Board", r.is_volunteer && "Volunteer", r.do_not_email && "Do not email", r.do_not_call && "Do not call", r.do_not_mail && "Do not mail"]
                .filter(Boolean).join(", ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
