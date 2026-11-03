// Has a gift been thanked? Either someone ticked it off (letter, call, card…)
// or a thank-you email went out from the CRM on or after the gift date.
// In-kind gifts count only when ticked off or when their acknowledgment
// letter is emailed, since the donor needs that letter for their taxes.

export type EmailLite = {
  contact_id: string | null;
  sent_at: string;
  subject: string;
  template_name: string | null;
  status: string;
};

export type GiftLite = {
  id: string;
  contact_id: string;
  gift_date: string;
  thanked_on: string | null;
  thanked_method: string | null;
  thanked_by_name?: string | null;
  gift_type?: string;
};

export type ThankStatus =
  | { kind: "thanked"; on: string; method: string; by: string | null }
  | { kind: "emailed"; on: string; subject: string }
  | { kind: "needed" };

/** True for an email meant as a thank-you for a gift (not an in-kind letter or a renewal). */
export function isThankYouEmail(m: EmailLite): boolean {
  if (m.status !== "sent") return false;
  const name = m.template_name ?? "";
  if (/^(in-kind|auction)/i.test(name)) return false; // those mark their own gifts
  return /thank/i.test(name) || /thank/i.test(m.subject);
}

/** Thank-you emails per person, oldest first. */
export function thankYouEmailsByContact(emails: EmailLite[]): Map<string, EmailLite[]> {
  const by = new Map<string, EmailLite[]>();
  for (const m of emails) {
    if (!m.contact_id || !isThankYouEmail(m)) continue;
    const list = by.get(m.contact_id) ?? [];
    list.push(m);
    by.set(m.contact_id, list);
  }
  by.forEach((list) => list.sort((a, b) => a.sent_at.localeCompare(b.sent_at)));
  return by;
}

export function thankStatus(g: GiftLite, emailsByContact: Map<string, EmailLite[]>): ThankStatus {
  if (g.thanked_on) return { kind: "thanked", on: g.thanked_on, method: g.thanked_method ?? "Thanked", by: g.thanked_by_name ?? null };
  if (g.gift_type === "In-kind") return { kind: "needed" };
  const m = (emailsByContact.get(g.contact_id) ?? []).find((e) => e.sent_at.slice(0, 10) >= g.gift_date);
  if (m) return { kind: "emailed", on: m.sent_at, subject: m.subject };
  return { kind: "needed" };
}

/** Today in Arlington, as YYYY-MM-DD. */
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
}
