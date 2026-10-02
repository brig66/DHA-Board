"use client";

import { useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";
import { downloadCsv, money, shortDate } from "@/lib/format";
import { mapRows, type MapResult } from "@/lib/importMapper";

type ImportSummary = {
  gifts_added: number;
  gifts_skipped_already_imported: number;
  new_donors: number;
  gifts_matched_to_existing_donors: number;
  possible_duplicates_flagged: number;
};

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

  async function choose(list: FileList | null) {
    const chosen = Array.from(list ?? []);
    setFiles(chosen);
    setMapped(null);
    setSummary(null);
    setError(null);
    if (!chosen.length) return;
    setLabel(chosen.length === 1 ? chosen[0].name.replace(/\.[^.]+$/, "") : "Spreadsheet import");
    const combined: MapResult = { rows: [], skipped: [], recognized: [] };
    try {
      for (const f of chosen) {
        const result = mapRows(await readFile(f));
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
      gifts_added: 0, gifts_skipped_already_imported: 0, new_donors: 0,
      gifts_matched_to_existing_donors: 0, possible_duplicates_flagged: 0,
    };
    // keep gifts in date order so the newest details win, and send in batches
    const rows = [...mapped.rows].sort((a, b) =>
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
        (Object.keys(total) as (keyof ImportSummary)[]).forEach((k) => (total[k] += r[k]));
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
          Upload one or more North Texas Giving Day exports, or any spreadsheet of gifts (.csv or .xlsx). Each gift is matched to an
          existing donor when the email, or the name plus phone or address, matches. Gifts already in the CRM (same
          tracking number) are skipped, so uploading the same file twice is safe.
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

      {summary && (
        <section className="card p-5">
          <h2 className="font-display text-lg font-semibold">Import complete</h2>
          <ul className="mt-2 list-disc pl-5 text-sm">
            <li><strong>{summary.gifts_added}</strong> gifts added</li>
            <li><strong>{summary.new_donors}</strong> new donors created</li>
            <li><strong>{summary.gifts_matched_to_existing_donors}</strong> gifts matched to donors already in the CRM</li>
            <li><strong>{summary.gifts_skipped_already_imported}</strong> gifts skipped because they were already imported</li>
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
