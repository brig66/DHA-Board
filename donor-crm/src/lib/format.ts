export const money = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "—"
    : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const shortDate = (d: string | null | undefined) =>
  d
    ? new Date(d.length === 10 ? d + "T12:00:00" : d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "—";

export const fullName = (c: { first_name: string; last_name: string }) =>
  [c.first_name, c.last_name].filter(Boolean).join(" ") || "(no name)";

export const cityLine = (c: { city: string | null; state: string | null; zip: string | null }) =>
  [c.city, [c.state, c.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");

/** Downloads rows as a CSV file that opens directly in Excel. */
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export const MERGE_FIELDS: { tag: string; label: string }[] = [
  { tag: "{{first_name}}", label: "First name" },
  { tag: "{{last_name}}", label: "Last name" },
  { tag: "{{last_gift_amount}}", label: "Last gift amount" },
  { tag: "{{last_gift_event}}", label: "Last gift event" },
  { tag: "{{last_gift_date}}", label: "Last gift date" },
  { tag: "{{total_given}}", label: "Total given" },
  { tag: "{{first_gift_year}}", label: "First gift year" },
];
