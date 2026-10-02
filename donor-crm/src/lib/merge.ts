import { money } from "./format";
import type { ContactSummary } from "./types";

const longDate = (d: string | null) =>
  d
    ? new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

/** Same merge fields as the sending function, so the preview matches what donors receive. */
export function fillMergeFields(text: string, c: ContactSummary | undefined): string {
  if (!c) return text;
  const values: Record<string, string> = {
    first_name: c.first_name || "Friend",
    last_name: c.last_name || "",
    full_name: [c.first_name, c.last_name].filter(Boolean).join(" ") || "Friend",
    email: c.email || "",
    last_gift_amount: c.last_gift_amount === null ? "" : money(c.last_gift_amount),
    last_gift_date: longDate(c.last_gift_date),
    last_gift_event: c.last_gift_event || "",
    total_given: money(c.total_given),
    gift_count: String(c.gift_count ?? ""),
    first_gift_year: c.first_gift_date ? c.first_gift_date.slice(0, 4) : "",
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k) => (k in values ? values[k] : m));
}
