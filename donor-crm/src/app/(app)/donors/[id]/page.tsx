"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { setEmailRecipients } from "@/lib/data";
import { cityLine, fullName, money, shortDate } from "@/lib/format";
import ContactForm, { type ContactDraft } from "@/components/ContactForm";
import { GIFT_TYPES, type ContactSummary, type Donation, type EmailLog, type EventAttendance, type GiftType } from "@/lib/types";

type GiftDraft = {
  gift_date: string;
  amount: string;
  event_name: string;
  gift_type: GiftType;
  payment_method: string;
  notes: string;
};

const blankGift = (): GiftDraft => ({
  gift_date: new Date().toISOString().slice(0, 10),
  amount: "",
  event_name: "",
  gift_type: "Donation",
  payment_method: "",
  notes: "",
});

export default function DonorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contact, setContact] = useState<ContactSummary | null>(null);
  const [gifts, setGifts] = useState<Donation[]>([]);
  const [emails, setEmails] = useState<EmailLog[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [attended, setAttended] = useState<EventAttendance[]>([]);
  const [newEvent, setNewEvent] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [giftForm, setGiftForm] = useState<GiftDraft | null>(null);
  const [editGiftId, setEditGiftId] = useState<string | null>(null);
  const [openEmail, setOpenEmail] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [c, g, e, ev, at, atAll] = await Promise.all([
      supabase.from("contact_summary").select("*").eq("id", id).maybeSingle(),
      supabase.from("donations").select("*").eq("contact_id", id).order("gift_date", { ascending: false }),
      supabase.from("email_log").select("*").eq("contact_id", id).order("sent_at", { ascending: false }),
      supabase.from("donations").select("event_name").limit(10000),
      supabase.from("event_attendance").select("*").eq("contact_id", id).order("event_name"),
      supabase.from("event_attendance").select("event_name").limit(10000),
    ]);
    if (c.error) setError(c.error.message);
    setContact(c.data as ContactSummary | null);
    setGifts((g.data ?? []) as Donation[]);
    setEmails((e.data ?? []) as EmailLog[]);
    setAttended((at.data ?? []) as EventAttendance[]);
    setEvents(
      Array.from(
        new Set([...(ev.data ?? []), ...(atAll.data ?? [])].map((x: { event_name: string }) => x.event_name))
      ).sort()
    );
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function saveContact(d: ContactDraft) {
    setSaving(true);
    setError(null);
    const { error } = await createClient()
      .from("contacts")
      .update({ ...d, updated_at: new Date().toISOString() })
      .eq("id", id);
    setSaving(false);
    if (error) return setError(error.message);
    setEditing(false);
    load();
  }

  async function deleteContact() {
    if (!contact) return;
    if (!confirm(`Delete ${fullName(contact)} and all ${contact.gift_count} of their gifts? This cannot be undone.`)) return;
    const { error } = await createClient().from("contacts").delete().eq("id", id);
    if (error) return setError(error.message);
    router.push("/donors");
  }

  async function saveGift(e: React.FormEvent) {
    e.preventDefault();
    if (!giftForm) return;
    const amount = parseFloat(giftForm.amount.replace(/[^0-9.]/g, ""));
    if (isNaN(amount)) return setError("Enter the gift amount.");
    setError(null);
    const row = {
      gift_date: giftForm.gift_date,
      amount,
      event_name: giftForm.event_name.trim() || "General donation",
      gift_type: giftForm.gift_type,
      payment_method: giftForm.payment_method.trim() || null,
      notes: giftForm.notes.trim() || null,
    };
    const supabase = createClient();
    const { error } = editGiftId
      ? await supabase.from("donations").update(row).eq("id", editGiftId)
      : await supabase.from("donations").insert({ ...row, contact_id: id, source: "Entered by staff" });
    if (error) return setError(error.message);
    setGiftForm(null);
    setEditGiftId(null);
    load();
  }

  async function deleteGift(g: Donation) {
    if (!confirm(`Delete the ${money(g.amount)} gift from ${shortDate(g.gift_date)}?`)) return;
    const { error } = await createClient().from("donations").delete().eq("id", g.id);
    if (error) return setError(error.message);
    load();
  }

  function startEditGift(g: Donation) {
    setEditGiftId(g.id);
    setGiftForm({
      gift_date: g.gift_date,
      amount: String(g.amount),
      event_name: g.event_name,
      gift_type: g.gift_type ?? "Donation",
      payment_method: g.payment_method ?? "",
      notes: g.notes ?? "",
    });
  }

  async function addAttendance(e: React.FormEvent) {
    e.preventDefault();
    const name = newEvent.trim();
    if (!name) return;
    setError(null);
    const { error } = await createClient()
      .from("event_attendance")
      .upsert({ contact_id: id, event_name: name, source: "Entered by staff" }, { onConflict: "contact_id,event_name", ignoreDuplicates: true });
    if (error) return setError(error.message);
    setNewEvent("");
    load();
  }

  async function removeAttendance(a: EventAttendance) {
    if (!confirm(`Remove "${a.event_name}" from this donor's events?`)) return;
    const { error } = await createClient().from("event_attendance").delete().eq("id", a.id);
    if (error) return setError(error.message);
    load();
  }

  function emailThisDonor() {
    setEmailRecipients([id]);
    router.push("/email");
  }

  if (!contact) return <p className="muted">{error ?? "Loading…"}</p>;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/donors" className="text-sm font-semibold text-teal-700">← All donors</Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-semibold">{fullName(contact)}</h1>
            {contact.organization && contact.organization !== fullName(contact) && (
              <p className="text-sm font-semibold">{contact.organization}</p>
            )}
            {contact.is_board_member && <span className="pill pill-good mt-1">Board member</span>}
            <p className="muted text-sm">
              {money(contact.total_given)} given across {contact.gift_count} gift{contact.gift_count === 1 ? "" : "s"}
              {contact.first_gift_date && <> &middot; donor since {contact.first_gift_date.slice(0, 4)}</>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!contact.is_anonymous && (
              <button
                className="btn btn-primary"
                onClick={emailThisDonor}
                disabled={!contact.email || contact.do_not_email}
                title={contact.do_not_email ? "Marked do-not-email" : !contact.email ? "No email address" : ""}
              >
                Send email
              </button>
            )}
            <button className="btn btn-secondary" onClick={() => setEditing(!editing)}>
              {editing ? "Cancel editing" : "Edit details"}
            </button>
            <button className="btn btn-danger" onClick={deleteContact}>
              Delete donor
            </button>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-coral-600">{error}</p>}

      <section className="card p-6">
        {editing ? (
          <ContactForm initial={contact} saving={saving} onSave={saveContact} submitLabel="Save changes" />
        ) : (
          <dl className="grid gap-4 text-sm md:grid-cols-3">
            <Item label="Email">
              {contact.email ? <a className="text-teal-700" href={`mailto:${contact.email}`}>{contact.email}</a> : "—"}
              {contact.alt_emails.map((e) => (
                <div key={e} className="muted text-xs">also {e}</div>
              ))}
              {contact.do_not_email && <div><span className="pill pill-bad mt-1">Do not email</span></div>}
            </Item>
            <Item label="Phone">
              {contact.phone ? <a className="text-teal-700" href={`tel:${contact.phone.replace(/\D/g, "")}`}>{contact.phone}</a> : "—"}
              {contact.alt_phones.map((p) => (
                <div key={p} className="muted text-xs">also {p}</div>
              ))}
            </Item>
            <Item label="Mailing address">
              {contact.address ?? "—"}
              <div>{cityLine(contact)}</div>
            </Item>
            <Item label="Last gift">
              {money(contact.last_gift_amount)} on {shortDate(contact.last_gift_date)}
              <div className="muted text-xs">{contact.last_gift_event}</div>
            </Item>
            <Item label="Last emailed">{contact.last_emailed_at ? shortDate(contact.last_emailed_at) : "Never"}</Item>
            <Item label="Notes">
              <span className="whitespace-pre-wrap">{contact.notes || "—"}</span>
            </Item>
          </dl>
        )}
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-display text-lg font-semibold">Gifts</h2>
          {!giftForm && (
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditGiftId(null); setGiftForm(blankGift()); }}>
              + Record a gift
            </button>
          )}
        </div>

        {giftForm && (
          <form onSubmit={saveGift} className="grid gap-3 border-t border-[var(--border)] bg-[#faf8f3] p-4 md:grid-cols-6">
            <div className="md:col-span-6">
              <label className="label">Type of gift</label>
              <div className="mt-1 flex flex-wrap gap-4 text-sm">
                {GIFT_TYPES.map((t) => (
                  <label key={t} className="flex items-center gap-1.5">
                    <input type="radio" name="gift_type" checked={giftForm.gift_type === t}
                      onChange={() => setGiftForm({ ...giftForm, gift_type: t })} />
                    {t}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" required className="input mt-1" value={giftForm.gift_date}
                onChange={(e) => setGiftForm({ ...giftForm, gift_date: e.target.value })} />
            </div>
            <div>
              <label className="label">{giftForm.gift_type === "In-kind" ? "Value ($)" : "Amount ($)"}</label>
              <input required inputMode="decimal" className="input mt-1" value={giftForm.amount}
                onChange={(e) => setGiftForm({ ...giftForm, amount: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Event or campaign</label>
              <input list="event-list" className="input mt-1" placeholder="e.g. NTX Giving Day 2026" value={giftForm.event_name}
                onChange={(e) => setGiftForm({ ...giftForm, event_name: e.target.value })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Payment method</label>
              <input list="pay-list" className="input mt-1" value={giftForm.payment_method}
                onChange={(e) => setGiftForm({ ...giftForm, payment_method: e.target.value })} />
              <datalist id="pay-list">
                {["Check", "Cash", "Credit Card", "PayPal", "Stock", "In-kind"].map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div className="md:col-span-6">
              <label className="label">Notes</label>
              <input className="input mt-1" value={giftForm.notes}
                onChange={(e) => setGiftForm({ ...giftForm, notes: e.target.value })} />
            </div>
            <div className="flex gap-2 md:col-span-6">
              <button className="btn btn-primary">{editGiftId ? "Save gift" : "Add gift"}</button>
              <button type="button" className="btn btn-secondary" onClick={() => { setGiftForm(null); setEditGiftId(null); }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th className="text-right">Amount</th>
                <th>Event</th>
                <th>Details</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {gifts.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap">{shortDate(g.gift_date)}</td>
                  <td className="text-right">
                    {money(g.amount)}
                    {g.net_amount !== null && Number(g.net_amount) !== Number(g.amount) && (
                      <div className="muted text-xs">net {money(g.net_amount)}</div>
                    )}
                  </td>
                  <td>
                    {g.event_name}
                    {g.gift_type && g.gift_type !== "Donation" && (
                      <div><span className="pill pill-warn mt-1">{g.gift_type}</span></div>
                    )}
                  </td>
                  <td className="text-xs">
                    {[g.payment_method, g.fundraiser_page && `Fundraiser: ${g.fundraiser_page}`, g.recognition_name && `Recognition: ${g.recognition_name}`, g.dedication, g.notes, g.tracking_no && `Tracking #${g.tracking_no}`]
                      .filter(Boolean)
                      .map((x) => <div key={String(x)}>{x}</div>)}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <button className="text-xs font-semibold text-teal-700" onClick={() => startEditGift(g)}>Edit</button>
                    <button className="ml-3 text-xs font-semibold text-coral-600" onClick={() => deleteGift(g)}>Delete</button>
                  </td>
                </tr>
              ))}
              {gifts.length === 0 && (
                <tr><td colSpan={5} className="muted p-4 text-center">No gifts recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Events attended</h2>
          <form onSubmit={addAttendance} className="flex flex-wrap items-center gap-2">
            <input list="event-list" className="input w-64" placeholder="e.g. Love That Smile 2026" value={newEvent}
              onChange={(e) => setNewEvent(e.target.value)} />
            <datalist id="event-list">
              {events.map((e) => <option key={e} value={e} />)}
            </datalist>
            <button className="btn btn-secondary btn-sm" disabled={!newEvent.trim()}>+ Add event</button>
          </form>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {attended.map((a) => (
            <span key={a.id} className="pill pill-good gap-2">
              {a.event_name}
              <button className="font-bold" title="Remove" onClick={() => removeAttendance(a)}>×</button>
            </span>
          ))}
          {attended.length === 0 && <p className="muted text-sm">No events recorded. Attendee lists you import show up here.</p>}
        </div>
      </section>

      <section className="card overflow-hidden">
        <h2 className="p-4 font-display text-lg font-semibold">Email history</h2>
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>Subject</th>
                <th>By</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {emails.map((m) => (
                <Fragment key={m.id}>
                  <tr className="cursor-pointer" onClick={() => setOpenEmail(openEmail === m.id ? null : m.id)}>
                    <td className="whitespace-nowrap">{shortDate(m.sent_at)}</td>
                    <td className="font-semibold text-teal-700">{m.subject}</td>
                    <td>{m.sent_by_name ?? "—"}</td>
                    <td>
                      <span className={`pill ${m.status === "sent" ? "pill-good" : "pill-bad"}`}>{m.status}</span>
                      {m.error && <div className="muted text-xs">{m.error}</div>}
                    </td>
                  </tr>
                  {openEmail === m.id && (
                    <tr>
                      <td colSpan={4} className="whitespace-pre-wrap bg-[#faf8f3] text-sm">
                        To: {m.to_email}
                        {"\n\n"}
                        {m.body}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
              {emails.length === 0 && (
                <tr><td colSpan={4} className="muted p-4 text-center">No emails sent from the CRM yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}
