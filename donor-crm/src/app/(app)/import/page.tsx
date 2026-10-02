"use client";

import { useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, money, shortDate } from "@/lib/format";
import { looksLikeAttendeeList, mapAttendees, mapRows, type AttendeeRow, type MapResult } from "@/lib/importMapper";

type ImportSummary = {
  gifts_added: number;
  gifts_skipped_already_imported: number;
  gifts_skipped_recorded_elsewhere: number;
  new_donors: number;
  gifts_matched_to_existing_donors: number;
  possible_duplicates_flagged: number;
};

type AttendeeSummary = {
  attendees_added: number;
  attendees_already_recorded: number;
  new_donors: number;
  matched_to_existing_donors: number;
  possible_duplicates_flagged: number;
};

type AttendeeFile = {
  fileName: string;
  rows: AttendeeRow[];
  skipped: { line: number; reason: string }[];
  event: string;
};

/** "crm_2024_lts.csv" -> "Love That Smile 2024"; "2024 seminar.csv" -> "DHA Summer Seminar 2024" */
function guessEvent(fileName: string): string {
  const year = fileName.match(/20\d\d/)?.[0] ?? "";
  if (/lts|love.?that.?smile/i.test(fileName)) return `Love That Smile ${year}`.trim();
  if (/seminar/i.test(fileName)) return `DHA Summer Seminar ${year}`.trim();
  if (/golf/i.test(fileName)) return `DHA Golf Tournament ${year}`.trim();
  return "";
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "First name", last_name: "Last name", full_name: "Full name", email: "Email", phone: "Phone",
  address: "Address", city: "City", state: "State", zip: "Zip", gift_date: "Date", amount: "Amount",
  event_name: "Event", tracking_no: "Tracking #", payment_method: "Payment method",
};

async function readFile(file: File): Promise<Record<string, unknown>[]> {
  if (/\.xlsx$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file");
    const rows = await readXlsxFile(file);
    const [header, ...body] = rows;
    const names = (header ?? []).map((h) => String(h ?? "").trim());
    return body.map((r) => Object.fromEntries(names.map((n, i) => [n, r[i]])));
  }
  if (/\.xls$/i.test(file.name)) {
    throw new Error("Older .xls files can't be read. In Excel, choose File → Save As → Excel Workbook (.xlsx) or CSV, then upload that.");
  }
  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  return parsed.data;
}

export default function ImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [mapped, setMapped] = useState<MapResult | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [attendeeFiles, setAttendeeFiles] = useState<AttendeeFile[] | null>(null);
  const [attendeeSummary, setAttendeeSummary] = useState<AttendeeSummary | null>(null);
  const [knownEvents, setKnownEvents] = useState<string[]>([]);

  async function choose(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    setFiles(chosen);
    setMapped(null);
    setSummary(null);
    setAttendeeFiles(null);
    setAttendeeSummary(null);
    setError(null);
    if (!chosen.length) return;
    setLabel(chosen.length === 1 ? chosen[0].name.replace(/\.[^.]+$/, "") : "Spreadsheet import");
    const combined: MapResult = { rows: [], skipped: [], recognized: [] };
    try {
      const sheets = await Promise.all(chosen.map(async (f) => ({ f, raw: await readFile(f) })));
      const lists = sheets.filter((x) => looksLikeAttendeeList(x.raw));
      if (lists.length && lists.length < sheets.length) {
        setError("Some of these files are attendee lists (no gift amounts) and some are gift files. Please upload them separately.");
        return;
      }
      if (lists.length) {
        setAttendeeFiles(
          lists.map(({ f, raw }) => {
            const res = mapAttendees(raw);
            return { fileName: f.name, rows: res.rows, skipped: res.skipped, event: guessEvent(f.name) };
          })
        );
        const supabase = createClient();
        const [g, a] = await Promise.all([
          supabase.from("donations").select("event_name").limit(10000),
          supabase.from("event_attendance").select("event_name").limit(10000),
        ]);
        setKnownEvents(
          Array.from(new Set([...(g.data ?? []), ...(a.data ?? [])].map((x: { event_name: string }) => x.event_name))).sort()
        );
        return;
      }
      for (const { f, raw } of sheets) {
        const result = mapRows(raw);
        if (!result.recognized.includes("amount") || !result.recognized.includes("gift_date")) {
          setError(
            `"${f.name}" needs at least a date column and an amount column. Download the blank template to see the expected headings.`
          );
        }
        combined.rows.push(...result.rows);
        combined.skipped.push(
          ...result.skipped.map((s) => ({ ...s, reason: chosen.length > 1 ? `${s.reason}, ${f.name}` : s.reason }))
        );
        combined.recognized = Array.from(new Set([...combined.recognized, ...result.recognized]));
      }
      setMapped(combined);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runImport() {
    if (!mapped?.rows.length) return;
    setBusy(true);
    setError(null);
    setProgress(0);
    const supabase = createClient();
    const total: ImportSummary = {
      gifts_added: 0, gifts_skipped_already_imported: 0, gifts_skipped_recorded_elsewhere: 0, new_donors: 0,
      gifts_matched_to_existing_donors: 0, possible_duplicates_flagged: 0,
    };
    // keep gifts in date order so the newest details win, and send in batches;
    // offline re-entries go last so the original online gift is already saved
    const rows = [...mapped.rows].sort(
      (a, b) =>
        Number(a.check_reentry) - Number(b.check_reentry) ||
        (a.gift_date + (a.gift_time ?? "")).localeCompare(b.gift_date + (b.gift_time ?? ""))
    );
    try {
      for (let i = 0; i < rows.length; i += 200) {
        const { data, error } = await supabase.rpc("import_donations", {
          rows: rows.slice(i, i + 200),
          source_label: label || "Spreadsheet import",
        });
        if (error) throw error;
        const r = data as ImportSummary;
        (Object.keys(total) as (keyof ImportSummary)[]).forEach((k) => (total[k] += r[k] ?? 0));
        setProgress(Math.min(rows.length, i + 200));
      }
      setSummary(total);
    } catch (e) {
      setError(
        `Import stopped: ${(e as Error).message}. Gifts imported before the error are saved; running the same file again will skip them.`
      );
    }
    setBusy(false);
  }

  async function runAttendeeImport() {
    if (!attendeeFiles?.length) return;
    if (attendeeFiles.some((f) => !f.event.trim())) return setError("Enter the event name for each list.");
    setBusy(true);
    setError(null);
    setProgress(0);
    const supabase = createClient();
    const total: AttendeeSummary = {
      attendees_added: 0, attendees_already_recorded: 0, new_donors: 0, matched_to_existing_donors: 0,
      possible_duplicates_flagged: 0,
    };
    let done = 0;
    try {
      for (const f of attendeeFiles) {
        for (let i = 0; i < f.rows.length; i += 200) {
          const { data, error } = await supabase.rpc("import_attendees", {
            rows: f.rows.slice(i, i + 200),
            event: f.event.trim(),
            source_label: `${f.event.trim()} attendee list`,
          });
          if (error) throw error;
          const r = data as AttendeeSummary;
          (Object.keys(total) as (keyof AttendeeSummary)[]).forEach((k) => (total[k] += r[k] ?? 0));
          done += Math.min(200, f.rows.length - i);
          setProgress(done);
        }
      }
      setAttendeeSummary(total);
    } catch (e) {
      setError(
        `Import stopped: ${(e as Error).message}. People imported before the error are saved; running the same list again is safe.`
      );
    }
    setBusy(false);
  }

  function downloadTemplate() {
    downloadCsv(
      "DHA donor import template.csv",
      ["First Name", "Last Name", "Email", "Phone", "Address", "City", "State", "Zip", "Date", "Amount", "Event", "Payment Method", "Notes"],
      [["Jane", "Smith", "jane@example.com", "817-555-0100", "123 Main St", "Arlington", "TX", "76010", "9/18/2025", "100.00", "NTX Giving Day 2025", "Check", "Thank-you card mailed"]]
    );
  }

  const totalAmount = mapped?.rows.reduce((s, r) => s + r.amount, 0) ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold">Import donors and gifts</h1>
        <p className="muted text-sm">
          Upload North Texas Giving Day exports, the donation website&rsquo;s Donation History export, or any spreadsheet of
          gifts (.csv or .xlsx). Each gift is matched to an existing donor when the email, or the name plus phone or
          address, matches. Gifts already in the CRM (same tracking number) are skipped, so uploading the same file twice
          is safe. You can also upload an <strong>event attendee list</strong> (names and contact details, no amounts) to
          record who came to an event.
        </p>
      </div>

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <label className="btn btn-primary cursor-pointer">
            Choose file(s)
            <input
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,text/csv"
              className="hidden"
              onChange={(e) => choose(e.target.files)}
            />
          </label>
          {files.length > 0 && <span className="text-sm">{files.map((f) => f.name).join(", ")}</span>}
          <button className="btn btn-secondary btn-sm ml-auto" onClick={downloadTemplate}>
            Download blank template
          </button>
        </div>
        {error && <p className="text-sm text-coral-600">{error}</p>}
      </section>

      {mapped && (
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="font-display text-lg font-semibold">Check before importing</h2>
          <p className="text-sm">
            Found <strong>{mapped.rows.length} gifts</strong> totaling <strong>{money(totalAmount)}</strong>.
            {mapped.skipped.length > 0 && (
              <span className="text-[#b8862e]">
                {" "}
                {mapped.skipped.length} row{mapped.skipped.length === 1 ? "" : "s"} will be left out:{" "}
                {mapped.skipped.slice(0, 8).map((s) => `row ${s.line} (${s.reason})`).join(", ")}
                {mapped.skipped.length > 8 && "…"}
              </span>
            )}
          </p>
          <p className="muted text-xs">
            Columns recognized:{" "}
            {mapped.recognized.filter((k) => FIELD_LABELS[k]).map((k) => FIELD_LABELS[k]).join(", ") || "none"}
          </p>

          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Donor</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Address</th>
                  <th className="text-right">Amount</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {mapped.rows.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap">{shortDate(r.gift_date)}</td>
                    <td>{r.anonymous ? <em>Anonymous</em> : `${r.first_name} ${r.last_name}`}</td>
                    <td>{r.email ?? "—"}</td>
                    <td className="whitespace-nowrap">{r.phone ?? "—"}</td>
                    <td>{[r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}</td>
                    <td className="text-right">{money(r.amount)}</td>
                    <td>{r.event_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mapped.rows.length > 10 && <p className="muted text-xs">Showing the first 10 of {mapped.rows.length}.</p>}

          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <label className="label">Label for this import (shown on each gift)</label>
              <input className="input mt-1" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <button className="btn btn-primary" disabled={busy || !mapped.rows.length || !!error} onClick={runImport}>
              {busy ? `Importing… ${progress}/${mapped.rows.length}` : `Import ${mapped.rows.length} gifts`}
            </button>
          </div>
        </section>
      )}

      {attendeeFiles && (
        <section className="card flex flex-col gap-4 p-5">
          <h2 className="font-display text-lg font-semibold">Attendee list{attendeeFiles.length > 1 ? "s" : ""}</h2>
          <p className="text-sm">
            These files have names and contact details but no gift amounts, so each person will be added (or matched to
            an existing donor) and marked as having attended the event you enter below.
          </p>
          <datalist id="known-events">
            {knownEvents.map((e) => <option key={e} value={e} />)}
          </datalist>
          {attendeeFiles.map((f, idx) => (
            <div key={f.fileName} className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-64 flex-1">
                  <label className="label">Event attended, for {f.fileName}</label>
                  <input
                    list="known-events"
                    className="input mt-1"
                    placeholder="e.g. Love That Smile 2026"
                    value={f.event}
                    onChange={(e) =>
                      setAttendeeFiles(attendeeFiles.map((x, i) => (i === idx ? { ...x, event: e.target.value } : x)))
                    }
                  />
                </div>
                <p className="text-sm">
                  <strong>{f.rows.length} people</strong>
                  {f.skipped.length > 0 && (
                    <span className="text-[#b8862e]">
                      {" "}· {f.skipped.length} left out ({Array.from(new Set(f.skipped.map((s) => s.reason))).join(", ").toLowerCase()})
                    </span>
                  )}
                </p>
              </div>
              <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Address</th>
                    </tr>
                  </thead>
                  <tbody>
                    {f.rows.slice(0, 5).map((r, i) => (
                      <tr key={i}>
                        <td>{[r.first_name, r.last_name].filter(Boolean).join(" ")}</td>
                        <td>{r.email ?? "—"}</td>
                        <td className="whitespace-nowrap">{r.phone ?? "—"}</td>
                        <td>{[r.address, r.city, r.state, r.zip].filter(Boolean).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {f.rows.length > 5 && <p className="muted text-xs">Showing the first 5 of {f.rows.length}.</p>}
            </div>
          ))}
          <div>
            <button
              className="btn btn-primary"
              disabled={busy || attendeeFiles.some((f) => !f.event.trim())}
              onClick={runAttendeeImport}
            >
              {busy
                ? `Importing… ${progress}/${attendeeFiles.reduce((s, f) => s + f.rows.length, 0)}`
                : `Import ${attendeeFiles.reduce((s, f) => s + f.rows.length, 0)} attendees`}
            </button>
          </div>
        </section>
      )}

      {attendeeSummary && (
        <section className="card p-5">
          <h2 className="font-display text-lg font-semibold">Import complete</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            <li><strong>{attendeeSummary.attendees_added}</strong> event attendances recorded</li>
            <li><strong>{attendeeSummary.matched_to_existing_donors}</strong> people matched to contacts already in the CRM</li>
            <li><strong>{attendeeSummary.new_donors}</strong> new contacts created</li>
            {attendeeSummary.attendees_already_recorded > 0 && (
              <li>
                <strong>{attendeeSummary.attendees_already_recorded}</strong> already recorded for that event (listed twice, or
                imported before)
              </li>
            )}
            <li>
              <strong>{attendeeSummary.possible_duplicates_flagged}</strong> possible duplicates flagged for review
              {attendeeSummary.possible_duplicates_flagged > 0 && (
                <> — <Link href="/duplicates" className="font-semibold text-teal-700">review them now</Link></>
              )}
            </li>
          </ul>
        </section>
      )}

      {summary && (
        <section className="card p-5">
          <h2 className="font-display text-lg font-semibold">Import complete</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            <li><strong>{summary.gifts_added}</strong> gifts added</li>
            <li><strong>{summary.new_donors}</strong> new donors created</li>
            <li><strong>{summary.gifts_matched_to_existing_donors}</strong> gifts matched to donors already in the CRM</li>
            <li><strong>{summary.gifts_skipped_already_imported}</strong> gifts skipped because they were already imported</li>
            {summary.gifts_skipped_recorded_elsewhere > 0 && (
              <li>
                <strong>{summary.gifts_skipped_recorded_elsewhere}</strong> offline entries skipped because the same gift
                was already recorded online (same donor and amount within 5 days)
              </li>
            )}
            <li>
              <strong>{summary.possible_duplicates_flagged}</strong> possible duplicates flagged for review
              {summary.possible_duplicates_flagged > 0 && (
                <> — <Link href="/duplicates" className="font-semibold text-teal-700">review them now</Link></>
              )}
            </li>
          </ul>
        </section>
      )}
    </div>
  );
}
