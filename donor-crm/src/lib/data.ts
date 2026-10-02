import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactSummary, Donation } from "./types";

/** Loads every row of a table/view, 1,000 at a time (Supabase's page size). */
async function fetchAll<T>(supabase: SupabaseClient, table: string, columns = "*"): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export const fetchAllContacts = (s: SupabaseClient) => fetchAll<ContactSummary>(s, "contact_summary");
export const fetchAllDonations = (s: SupabaseClient) =>
  fetchAll<Pick<Donation, "id" | "contact_id" | "gift_date" | "amount" | "event_name">>(
    s,
    "donations",
    "id, contact_id, gift_date, amount, event_name"
  );

const RECIPIENTS_KEY = "dha-email-recipients";

export function setEmailRecipients(ids: string[]) {
  try {
    sessionStorage.setItem(RECIPIENTS_KEY, JSON.stringify(ids));
  } catch {
    /* storage unavailable; the email page will start empty */
  }
}

export function getEmailRecipients(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(RECIPIENTS_KEY) || "[]");
  } catch {
    return [];
  }
}
